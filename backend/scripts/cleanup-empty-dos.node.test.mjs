import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs,listObjects,singleDeployment,runCleanup} from './cleanup-empty-dos-core.mjs';
const id='a'.repeat(64), other='b'.repeat(64), original='11111111-1111-4111-8111-111111111111', maintenance='22222222-2222-4222-8222-222222222222';
const options=()=>parseArgs([]);
function harness(overrides={}) {
  let current={id:'old',version:original}; const events=[], reports=[];
  const io={target:{worker:'test'},current:async()=>({...current}),page:async()=>({result:[{id,hasStoredData:true}]}),
    upload:async policy=>{events.push(['upload',policy]);return maintenance;},
    deploy:async version=>{events.push(['deploy',version]);current={id:'ours',version};},
    restore:async version=>{events.push(['restore',version]);current={id:'restored',version};},
    call:async object=>{events.push(['call',object]);return {status:'candidate',sessions:0};},
    save:async report=>reports.push(structuredClone(report)),checkInterrupted:()=>{},progress:()=>{},...overrides};
  return {io,events,reports,setCurrent:value=>current=value};
}
test('CLI defaults, explicit destructive ID, malformed and duplicate arguments',()=>{
 assert.deepEqual(options(),{apply:false,id:null,account:null,help:false});
 assert.deepEqual(parseArgs(['--id',id,'--apply','--account','f'.repeat(32)]),{apply:true,id,account:'f'.repeat(32),help:false});
 assert.equal(parseArgs(['--help']).help,true);
 for(const args of [['--id'],['--id','x'],['--id','A'.repeat(64)],['--account','x'],['--apply','--apply'],['--unknown']]) assert.throws(()=>parseArgs(args));
 assert.deepEqual(singleDeployment({id:'d',versions:[{version_id:original,percentage:100}]}),{id:'d',version:original});
 for(const value of [null,{}, {id:'x',versions:[]},{id:'x',versions:[{version_id:original,percentage:50}]},
   {id:'x',versions:[{version_id:original,percentage:100},{version_id:maintenance,percentage:0}]}])assert.throws(()=>singleDeployment(value));
});
test('pagination supports empty middle pages and rejects loops, duplicates and invalid objects',async()=>{
 const calls=[];assert.deepEqual(await listObjects(async cursor=>{calls.push(cursor);return cursor===null?{result:[{id}],result_info:{cursor:'a'}}:cursor==='a'?{result:[],result_info:{cursor:'b'}}:{result:[{id:other,hasStoredData:false}]};}),[{id,hasStoredData:null},{id:other,hasStoredData:false}]);
 assert.deepEqual(calls,[null,'a','b']);
 for(const page of [()=>({result:[{id},{id}]}),()=>({result:[],result_info:{cursor:'same'}}),()=>({result:[{id:'bad'}]}),()=>({result:[{id,hasStoredData:'false'}]}),()=>({result:[],result_info:{cursor:'\n'}}),()=>({result:null})])await assert.rejects(listObjects(page));
});
test('preview never grants apply, records recovery before upload and restores production',async()=>{
 const h=harness();const report=await runCleanup(options(),h.io);
 assert.equal(h.events[0][1].apply,false);assert.equal(h.reports[0].original.version,original);
 assert.equal(report.restored,true);assert.deepEqual(h.events.map(e=>e[0]),['upload','deploy','call','restore']);
});
test('already empty objects are not woken; an entirely empty page does not deploy',async()=>{
 const h=harness({page:async()=>({result:[{id,hasStoredData:false}]})});
 const result=await runCleanup(options(),h.io);assert.deepEqual(h.events,[]);assert.equal(result.results[0].status,'already_empty');
});
test('explicit ID bypasses enumeration and targets exactly that object with all-data policy',async()=>{
 const h=harness({page:async()=>{throw new Error('must not enumerate');},call:async()=>({status:'deleted',unexpected:'SECRET'})});
 const result=await runCleanup(parseArgs(['--id',id,'--apply']),h.io);
 assert.deepEqual(h.events[0][1],{ids:[id],forceId:id,apply:true});assert.equal(result.results[0].status,'deleted');
 assert.equal(JSON.stringify(h.reports).includes('SECRET'),false);
});
test('read faults and busy objects produce nonzero failure after processing remaining objects and restoration',async()=>{
 for(const result of [{status:'failed',error:'SECRET'}, {status:'busy'}, {status:'invalid'}, {status:'deleted'}]){
  const h=harness({page:async()=>({result:[{id},{id:other}]}),call:async object=>object===id?result:{status:'preserved',sessions:2}});
  await assert.rejects(runCleanup(options(),h.io));
  assert.equal(h.reports.at(-1).restored,true);assert.equal(h.reports.at(-1).results.length,2);
  assert.equal(JSON.stringify(h.reports).includes('SECRET'),false);
 }
 const h=harness({call:async()=>{throw new Error('SECRET');}});await assert.rejects(runCleanup(options(),h.io));assert.equal(JSON.stringify(h.reports).includes('SECRET'),false);
});
test('upload failure and pre-activation interruption never activate a version',async()=>{
 const h=harness({upload:async()=>{throw new Error('upload failed');}});await assert.rejects(runCleanup(options(),h.io));assert.equal(h.events.length,0);
 const interrupted=harness();interrupted.io.upload=async()=>{interrupted.io.checkInterrupted=()=>{throw new Error('interrupted');};return maintenance;};
 await assert.rejects(runCleanup(options(),interrupted.io));assert.equal(interrupted.events.length,0);
});
test('ambiguous deployment failure still restores if our version became active',async()=>{
 const h=harness();h.io.deploy=async version=>{h.setCurrent({id:'ours',version});throw new Error('connection lost');};
 await assert.rejects(runCleanup(options(),h.io));assert.equal(h.reports.at(-1).restored,true);assert.equal(h.events.at(-1)[0],'restore');
});
test('concurrent deployments before activation or between objects are not overwritten',async()=>{
 const h=harness();h.io.upload=async()=>{h.setCurrent({id:'other',version:original});return maintenance;};
 await assert.rejects(runCleanup(options(),h.io),/changed/);assert.deepEqual(h.events,[]);
 const active=harness({page:async()=>({result:[{id},{id:other}]})});active.io.call=async()=>{active.setCurrent({id:'other',version:original});return {status:'candidate'};};
 await assert.rejects(runCleanup(options(),active.io),/changed/);assert.equal(active.events.some(e=>e[0]==='restore'),false);assert.equal(active.reports.at(-1).restored,false);
});
test('failed restoration retains exact recovery version and returns failure',async()=>{
 const h=harness({restore:async()=>{throw new Error('restore failed');}});await assert.rejects(runCleanup(options(),h.io),/restore failed/);
 assert.equal(h.reports.at(-1).original.version,original);assert.equal(h.reports.at(-1).restored,false);assert.ok(h.reports.at(-1).restoreError);
});

import {connect} from './cleanup-empty-dos.mjs';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function platform() {
 const account='c'.repeat(32),namespace='d'.repeat(32), commands=[],requests=[];
 const binding={name:'AGENT',type:'durable_object_namespace',class_name:'UserAgentDO',namespace_id:namespace};
 const api={
  '/workers/services/test':{default_environment:{script:{migration_tag:'v1'}}},
  '/workers/scripts/test/settings':{bindings:[binding]},'/workers/subdomain':{subdomain:'test-account'},
  '/workers/scripts/test/subdomain':{enabled:true},
  '/workers/scripts/test/deployments':{deployments:[{id:'current',versions:[{version_id:original,percentage:100}]}]},
  ['/workers/scripts/test/versions/'+original]:{annotations:{}},
  ['/workers/scripts/test/versions/'+maintenance]:{resources:{bindings:[binding]}},
 };
 return {account,api,commands,requests,dependencies:{
  readConfig:()=>({name:'test',migrations:[{tag:'v1'}],durable_objects:{bindings:[{name:'AGENT',class_name:'UserAgentDO'}]}}),
  command:async(args,extra)=>{
   commands.push(args);
   if(args[0]==='whoami')return JSON.stringify({accounts:[{id:account}]});
   if(args[0]==='auth')return JSON.stringify({type:'oauth',token:'fake-private-token'});
   if(args[1]==='upload'){
     assert.equal(extra.CLOUDFLARE_ACCOUNT_ID,account);
     await writeFile(extra.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({type:'version-upload',version_id:maintenance})+'\n');
   }
   return '';
  },
  fetch:async(url,init)=>{
   requests.push({url,init});assert.equal(init.redirect,'error');
   if(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+account)){
    assert.equal(init.headers.Authorization,'Bearer fake-private-token');
    const path=url.slice(('https://api.cloudflare.com/client/v4/accounts/'+account).length);
    if(!(path in api))throw new Error('Unmocked API path '+path);
    return Response.json({success:true,result:api[path]});
   }
   assert.equal(url,'https://test.test-account.workers.dev/__maintenance/cleanup-do');
   assert.equal(JSON.parse(init.body).id,id);return Response.json({status:'candidate'});
  },
 }};
}
test('Wrangler adapter validates live target, builds a private entry, parses upload output and restores the exact version',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cleanup-adapter-'));try{
  const p=platform(),io=await connect(options(),dir,p.dependencies);
  assert.equal(io.target.namespace,'d'.repeat(32));assert.equal((await io.current()).version,original);
  assert.equal(await io.upload({ids:[id],forceId:id,apply:true}),maintenance);
  const source=await readFile(join(dir,'entry.mjs'),'utf8');assert.ok(source.includes('"apply":true'));assert.ok(source.includes('"forceId":"'+id+'"'));
  assert.equal(p.commands.some(c=>c.includes('--assets')),false);
  await io.deploy(maintenance);await io.restore(original);await io.call(id);
  assert.deepEqual(p.commands.filter(c=>c[1]==='deploy').map(c=>c[2]),[maintenance+'@100',original+'@100']);
  assert.equal(JSON.stringify(p.commands).includes('fake-private-token'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('adapter rejects wrong account, live namespace, disabled endpoint, upload mismatch and API errors',async()=>{
 for(const change of [p=>p.dependencies.readConfig=()=>({name:'wrong!'}),p=>p.api['/workers/scripts/test/settings']={bindings:[]},
  p=>p.api['/workers/services/test']={default_environment:{script:{migration_tag:'other'}}},p=>p.api['/workers/scripts/test/subdomain']={enabled:false},p=>p.dependencies.fetch=async()=>new Response('private',{status:403}),
  p=>p.dependencies.fetch=async()=>Response.json({success:false})]){
  const p=platform();change(p);await assert.rejects(connect(options(),'/unused',p.dependencies));
 }
 const p=platform();await assert.rejects(connect({...options(),account:'f'.repeat(32)},'/unused',p.dependencies),/account/);
 const dir=await mkdtemp(join(tmpdir(),'cleanup-adapter-'));try{
  const q=platform(),io=await connect(options(),dir,q.dependencies);
  q.api['/workers/scripts/test/versions/'+maintenance]={resources:{bindings:[]}};
  await assert.rejects(io.upload({ids:[id],forceId:null,apply:false}),/namespace/);
  assert.equal(q.commands.some(c=>c[1]==='deploy'),false);
  const fresh=await connect(options(),dir,q.dependencies);
  q.api['/workers/scripts/test/versions/'+maintenance]={resources:{bindings:q.api['/workers/scripts/test/settings'].bindings.concat({name:'extra',type:'d1',id:'other'})}};
  await assert.rejects(fresh.upload({ids:[id],forceId:null,apply:false}),/storage bindings/);
  assert.equal(q.commands.some(c=>c[1]==='deploy'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

import {resourceBindings} from './cleanup-empty-dos-core.mjs';
test('storage binding guard normalizes D1 aliases but rejects changed destinations',()=>{
 const left=[{name:'db',type:'d1',database_id:'original'},{name:'bucket',type:'r2_bucket',bucket_name:'bucket'}];
 const right=[{name:'bucket',type:'r2_bucket',bucket_name:'bucket'},{name:'db',type:'d1',id:'original'}];
 assert.deepEqual(resourceBindings(left),resourceBindings(right));
 right[1].id='other';assert.notDeepEqual(resourceBindings(left),resourceBindings(right));
});

test('a previous maintenance version cannot become the recovery baseline',async()=>{
 const h=harness({current:async()=>({id:'older-maintenance',version:maintenance,temporary:true})});
 await assert.rejects(runCleanup(options(),h.io),/restore it first/);assert.deepEqual(h.events,[]);
});
