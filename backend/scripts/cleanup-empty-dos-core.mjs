export const ID = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const HELP = `Usage: node backend/scripts/cleanup-empty-dos.mjs [--apply] [--id DO_ID] [--account ACCOUNT_ID]

Default: preview objects with no sessions, across all stored session purposes.
--apply     Delete eligible storage. Without this flag nothing is deleted.
--id ID     Target one DO and clear ALL its data, including nonempty/unreadable sessions.
            Requires --apply to delete; does not affect other objects.
--account   Cloudflare account ID; required if Wrangler has multiple accounts.

Both preview and apply temporarily deploy local backend code, then restore the original
production version. Use a quiet maintenance window; avoid concurrent releases and requests
to the target objects. Reports and recovery commands: backend/.wrangler/do-cleanup/.
Login first: npx wrangler login (from backend/).
`;
export function parseArgs(args) {
  const options = {apply:false,id:null,account:null,help:false}, seen=new Set();
  for(let i=0;i<args.length;i++) {
    const flag=args[i]; if(seen.has(flag)) throw new Error('Duplicate option: '+flag); seen.add(flag);
    if(flag==='--help'||flag==='-h') options.help=true;
    else if(flag==='--apply') options.apply=true;
    else if(flag==='--id'||flag==='--account') {
      const value=args[++i];
      if(!(flag==='--id'?ID:/^[a-f0-9]{32}$/).test(value??'')) throw new Error('Invalid '+flag);
      options[flag==='--id'?'id':'account']=value;
    } else throw new Error('Unknown option: '+flag);
  }
  return options;
}
export function singleDeployment(value) {
  if(!value?.id || value.versions?.length!==1 || value.versions[0].percentage!==100
    || !VERSION.test(value.versions[0].version_id)) throw new Error('A single production version at 100% is required.');
  return {id:value.id,version:value.versions[0].version_id};
}
export async function listObjects(page) {
  const items=[], ids=new Set(), cursors=new Set(); let cursor=null;
  do {
    const data=await page(cursor);
    if(!Array.isArray(data?.result)||data.result.length>100) throw new Error('Invalid object page');
    for(const row of data.result) {
      if(!ID.test(row?.id??'') || (row.hasStoredData!==undefined && typeof row.hasStoredData!=='boolean') || ids.has(row.id))
        throw new Error('Invalid or duplicate object');
      ids.add(row.id);items.push({id:row.id,hasStoredData:row.hasStoredData??null});
    }
    cursor=data.result_info?.cursor??null;
    if(cursor!==null && (typeof cursor!=='string'||cursor.length>4096||/[\x00-\x20\x7f]/.test(cursor))) throw new Error('Invalid object cursor');
    if(cursor && cursors.has(cursor)) throw new Error('Repeated object cursor');
    if(cursor)cursors.add(cursor);
  }while(cursor);
  return items;
}
const same=(a,b)=>a.id===b.id&&a.version===b.version;
export async function requireDeployment(current,expected) {
  if(!same(await current(),expected)) throw new Error('Production deployment changed; stopped to protect another release.');
}

/** Dependencies own processes, credentials and persistence. Always inspect reality after ambiguous deploy errors. */
export async function runCleanup(options, io) {
  const report={mode:options.id?'all-data-for-id':'empty-only',apply:options.apply,target:io.target,
    startedAt:new Date().toISOString(),original:await io.current(),maintenanceVersion:null,results:[],restored:false};
  if(report.original.temporary)throw new Error('A previous maintenance version is still active; restore it first.');
  const save=()=>io.save(report);
  await save();
  let failure=null, activationAttempted=false, active=null;
  try {
    io.checkInterrupted();
    const items=options.id?[{id:options.id,hasStoredData:null}]:await listObjects(io.page);
    const candidates=items.filter(row=>row.hasStoredData!==false);
    report.results=items.filter(row=>row.hasStoredData===false).map(row=>({id:row.id,status:'already_empty'}));
    await save();
    if(!candidates.length) {report.restored=true;await save();return report;}
    await requireDeployment(io.current,report.original); io.checkInterrupted();
    const version=await io.upload({ids:candidates.map(row=>row.id),forceId:options.id,apply:options.apply});
    if(!VERSION.test(version??'')) throw new Error('Upload did not return a valid version');
    report.maintenanceVersion=version; await save();
    await requireDeployment(io.current,report.original); io.checkInterrupted();
    activationAttempted=true;
    await io.deploy(version);
    active=await io.current();
    if(active.version!==version) throw new Error('Maintenance deployment was not activated');
    report.maintenanceDeployment=active;await save();
    for(const row of candidates) {
      io.checkInterrupted();await requireDeployment(io.current,active);
      let result;
      try {
        result=await io.call(row.id);
        if(!['candidate','preserved','busy','deleted','failed'].includes(result?.status)
          || (!options.apply && result.status==='deleted')) throw new Error('Invalid maintenance result');
        // Only retain bounded protocol fields, never unexpected response bodies or credentials.
        result={id:row.id,status:result.status,...(Number.isSafeInteger(result.sessions)?{sessions:result.sessions}:{}),
          ...(result.status==='failed'?{error:'maintenance_failed'}:{})};
      } catch {result={id:row.id,status:'failed',error:'maintenance_request_failed'};}
      report.results.push(result);await save();io.progress(result);
    }
    if(report.results.some(r=>['failed','busy'].includes(r.status))) throw new Error('Some objects failed or were busy; see the report.');
  } catch(error) {failure=error;report.error=error.message;}
  finally {
    try {
      if(activationAttempted) {
        const current=await io.current();
        if(current.version===report.maintenanceVersion && (!active||same(current,active))) {
          await io.restore(report.original.version);
          if((await io.current()).version!==report.original.version) throw new Error('Original version was not restored');
          report.restored=true;
        } else if(same(current,report.original)) report.restored=true;
        else throw new Error('Production changed; automatic restoration refused. Review the recovery command.');
      } else report.restored=true;
    } catch(error) {report.restoreError=error.message;failure??=error;}
    report.finishedAt=new Date().toISOString();await save();
  }
  if(failure) throw Object.assign(new Error(failure.message),{report});
  return report;
}

/** Compare storage destinations, allowing the two API spellings for D1 database IDs. */
export function resourceBindings(bindings) {
  return bindings.filter(b=>['durable_object_namespace','d1','r2_bucket','kv_namespace','analytics_engine'].includes(b.type))
    .map(b=>({name:b.name,type:b.type,resource:b.type==='d1'?(b.database_id??b.id):
      b.type==='r2_bucket'?b.bucket_name:b.type==='analytics_engine'?b.dataset:b.namespace_id,
      ...(b.type==='durable_object_namespace'?{class:b.class_name,script:b.script_name??null}:{}),
      ...(b.type==='r2_bucket'?{jurisdiction:b.jurisdiction??null}:{}),
    })).sort((a,b)=>a.name.localeCompare(b.name));
}
