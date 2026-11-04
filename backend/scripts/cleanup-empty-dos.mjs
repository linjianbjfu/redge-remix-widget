#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {HELP,parseArgs,singleDeployment,runCleanup,resourceBindings} from './cleanup-empty-dos-core.mjs';
const exec=promisify(execFile), backend=resolve(import.meta.dirname,'..'), repo=resolve(backend,'..');
const config=join(backend,'wrangler.jsonc'), cli=join(repo,'node_modules/wrangler/bin/wrangler.js');
const quote=value=>"'"+value.replaceAll("'", "'\\''")+"'";

/** No shell interpolation, inherited output, or credential-bearing subprocess errors. */
async function command(args,extra={},configPath=config) {
  try {return (await exec(process.execPath,[cli,...args,'--config',configPath],{
    cwd:backend,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',...extra},maxBuffer:16*1024*1024,timeout:300000,
  })).stdout;} catch(error) {throw new Error(`Wrangler ${args.slice(0,2).join(' ')} failed (exit ${error.code ?? 'unknown'}).`);}
}
export function maintenanceEntry(policy) {
  return `import app from ${JSON.stringify(join(backend,'src/index.ts'))};
import {MaintenanceUserAgentDO,handleCleanup,CLEANUP_PATH} from ${JSON.stringify(join(backend,'src/maintenance/cleanup-do.ts'))};
const policy=${JSON.stringify(policy)};
export class UserAgentDO extends MaintenanceUserAgentDO {
  constructor(ctx,env){super(ctx,env,policy);}
}
export default {...app,fetch(request,env,ctx){
  return new URL(request.url).pathname===CLEANUP_PATH ? handleCleanup(request,env,policy) : app.fetch(request,env,ctx);
}};
`;
}
export async function connect(options,work,dependencies={}) {
  const readConfig=dependencies.readConfig??(await import('wrangler')).unstable_readConfig;
  const run=dependencies.command??command, fetcher=dependencies.fetch??fetch;
  const local=readConfig({config});
  if(!/^[a-z0-9][a-z0-9-]*$/.test(local.name??'') || local.durable_objects?.bindings?.length!==1
    || local.durable_objects.bindings[0].name!=='AGENT' || local.durable_objects.bindings[0].class_name!=='UserAgentDO'
    || local.durable_objects.bindings[0].script_name) throw new Error('Expected the repository Worker with its own AGENT / UserAgentDO binding.');
  const identity=JSON.parse(await run(['whoami','--json']));
  const account=options.account??local.account_id??(identity.accounts?.length===1?identity.accounts[0].id:null);
  if(!/^[a-f0-9]{32}$/.test(account??'') || !identity.accounts?.some(a=>a.id===account)) throw new Error('Choose an accessible account with --account ACCOUNT_ID.');
  const auth=JSON.parse(await run(['auth','token','--json']));
  const headers=auth.type==='api_key'?{'X-Auth-Key':auth.key,'X-Auth-Email':auth.email}:{Authorization:`Bearer ${auth.token}`};
  const api=async(path)=>{
    const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+account+path,{
      headers,redirect:'error',signal:AbortSignal.timeout(30000),
    }).catch(()=>{throw new Error('Cloudflare management request failed');});
    if(!response.ok) throw new Error(`Cloudflare management request failed (HTTP ${response.status})`);
    const body=await response.json();if(body.success!==true)throw new Error('Cloudflare management request was rejected');return body;
  };
  const script='/workers/scripts/'+local.name;
  const settings=(await api(script+'/settings')).result;
  const binding=settings.bindings?.find(b=>b.name==='AGENT');
  if(binding?.type!=='durable_object_namespace'||binding.class_name!=='UserAgentDO'||!/^[a-f0-9]{32}$/.test(binding.namespace_id??''))
    throw new Error('The live AGENT binding does not match UserAgentDO.');
  const namespace=binding.namespace_id;
  const service=(await api('/workers/services/'+local.name)).result;
  if(!local.migrations?.length || local.migrations.at(-1).tag!==service?.default_environment?.script?.migration_tag)
    throw new Error('Pending or mismatched Durable Object migrations; maintenance upload refused.');
  const domain=(await api('/workers/subdomain')).result?.subdomain;
  if(!/^[a-z0-9][a-z0-9-]*$/.test(domain??'') || !(await api(script+'/subdomain')).result?.enabled)
    throw new Error('This script requires the Worker workers.dev endpoint to be enabled.');
  const target={account,worker:local.name,namespace,url:`https://${local.name}.${domain}.workers.dev`};
  const extra={CLOUDFLARE_ACCOUNT_ID:account};
  const token=randomBytes(32).toString('hex');
  const deployConfig=join(work,'deployment.json'), versionCache=new Map();
  await writeFile(deployConfig,JSON.stringify({name:local.name,account_id:account}),{mode:0o600});
  const versionInfo=async version=>{
    if(!versionCache.has(version))versionCache.set(version,(await api(script+'/versions/'+version)).result);
    return versionCache.get(version);
  };
  return {
    target,
    current:async()=>{
      const current=singleDeployment((await api(script+'/deployments')).result?.deployments?.[0]);
      return {...current,temporary:(await versionInfo(current.version)).annotations?.['workers/tag']?.startsWith('do-cleanup-')??false};
    },
    page:async cursor=>api(`/workers/durable_objects/namespaces/${namespace}/objects?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`),
    async upload(scope) {
      const entry=join(work,'entry.mjs'), output=join(work,'wrangler-output.jsonl');
      await writeFile(entry,maintenanceEntry({...scope,token,expiresAt:Date.now()+30*60*1000}),{mode:0o600});
      await run(['versions','upload',entry,'--outdir',join(work,'bundle'),'--keep-vars',
        '--tag','do-cleanup-'+randomBytes(8).toString('hex'),'--message','Temporary manual DO maintenance'],
        {...extra,WRANGLER_OUTPUT_FILE_PATH:output});
      const events=(await readFile(output,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      const version=events.findLast(event=>event.type==='version-upload')?.version_id;
      if(!version) throw new Error('Wrangler did not report an uploaded version.');
      const uploaded=await versionInfo(version);
      const remote=uploaded.resources?.bindings?.find(b=>b.name==='AGENT');
      if(remote?.namespace_id!==namespace) throw new Error('Uploaded version changed the AGENT namespace; activation refused.');
      if(JSON.stringify(resourceBindings(settings.bindings))!==JSON.stringify(resourceBindings(uploaded.resources.bindings)))
        throw new Error('Uploaded version changed storage bindings; activation refused.');
      return version;
    },
    deploy:async version=>{await run(['versions','deploy',`${version}@100`,'--yes','--message','Manual DO cleanup'],extra,deployConfig);},
    restore:async version=>{await run(['versions','deploy',`${version}@100`,'--yes','--message','Restore after DO cleanup'],extra,deployConfig);},
    async call(id) {
      const response=await fetcher(target.url+'/__maintenance/cleanup-do',{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({id}),redirect:'error',signal:AbortSignal.timeout(30000),
      });
      if(!response.ok)throw new Error('Maintenance request failed');return response.json();
    },
  };
}
export async function main(args) {
  const options=parseArgs(args);if(options.help){console.log(HELP);return;}
  const work=await mkdtemp(join(tmpdir(),'webclip-do-cleanup-'));
  let interrupted=false, reportPath;
  const stop=()=>{interrupted=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try {
    const io=await connect(options,work);
    const reportRoot=join(backend,'.wrangler/do-cleanup');await mkdir(reportRoot,{recursive:true});
    const reportDir=await mkdtemp(join(reportRoot,'run-'));reportPath=join(reportDir,'report.json');
    console.log(JSON.stringify({target:io.target,mode:options.id?'ALL DATA of '+options.id:'empty objects only',apply:options.apply,report:reportPath},null,2));
    console.log('Temporarily deploying the local backend. The previous production version will be restored.');
    const report=await runCleanup(options,{
      ...io,
      checkInterrupted:()=>{if(interrupted)throw new Error('Interrupted; restoring production.');},
      progress:result=>console.log(JSON.stringify(result)),
      async save(report) {
        const recoveryConfig=join(reportDir,'recovery.wrangler.json');
        await writeFile(recoveryConfig,JSON.stringify({name:io.target.worker,account_id:io.target.account}),{mode:0o600});
        const recovery=[process.execPath,cli,'versions','deploy',report.original.version+'@100','--yes','--name',io.target.worker,'--config',recoveryConfig];
        const payload={...report,recoveryCommand:`CLOUDFLARE_ACCOUNT_ID=${io.target.account} `+recovery.map(quote).join(' ')};
        await writeFile(reportPath+'.tmp',JSON.stringify(payload,null,2)+'\n',{mode:0o600});await rename(reportPath+'.tmp',reportPath);
      },
    });
    console.log(JSON.stringify({restored:report.restored,counts:Object.fromEntries([...new Set(report.results.map(r=>r.status))]
      .map(status=>[status,report.results.filter(r=>r.status===status).length])),report:reportPath},null,2));
  } finally {
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    await rm(work,{recursive:true,force:true});
    if(reportPath)console.log('Report and manual recovery command: '+reportPath);
  }
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
