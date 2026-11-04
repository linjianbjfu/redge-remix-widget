import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {unstable_dev} from 'wrangler';
import {runCleanup,parseArgs} from '../backend/scripts/cleanup-empty-dos-core.mjs';
import {maintenanceEntry} from '../backend/scripts/cleanup-empty-dos.mjs';
const repo=resolve(import.meta.dirname,'..'), root=await mkdtemp(join(tmpdir(),'webclip-cleanup-e2e-'));
await mkdir(join(repo,'.playwright-mcp'),{recursive:true});
const artifacts=await mkdtemp(join(repo,'.playwright-mcp/do-cleanup-e2e-'));
const original='11111111-1111-4111-8111-111111111111', maintenance='22222222-2222-4222-8222-222222222222';
const token=crypto.randomUUID(), fixture=join(repo,'test-cli/do-cleanup-fixture.ts'), entry=join(root,'maintenance.mjs');
let worker,base,current={id:'initial',version:original}, reports=[];
const config={name:'cleanup-e2e',main:fixture,compatibility_date:'2026-09-01',compatibility_flags:['nodejs_compat'],
 define:{'import.meta.url':'"file:///worker/index.js"'},
 durable_objects:{bindings:[{name:'AGENT',class_name:'UserAgentDO'}]},migrations:[{tag:'v1',new_sqlite_classes:['UserAgentDO']}]};
async function start(main){
 if(worker){await worker.stop();worker=undefined;}
 await writeFile(join(root,'wrangler.json'),JSON.stringify({...config,main}));
 worker=await unstable_dev(main,{config:join(root,'wrangler.json'),envFiles:[],port:0,inspectorPort:0,ip:'127.0.0.1',
   persistTo:join(root,'state'),logLevel:'error',experimental:{disableExperimentalWarning:true,disableDevRegistry:true,watch:false}});
 base=`http://${worker.address}:${worker.port}`;
}
async function fixtureCall(action,name,kind){const r=await fetch(base+'/__fixture',{method:'POST',body:JSON.stringify({action,name,kind}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();}
async function maintenanceCall(id){const r=await fetch(base+'/__maintenance/cleanup-do',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({id}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();}
try {
 await start(fixture);
 const ids={};for(const kind of ['empty','native','web','corrupt'])ids[kind]=(await fixtureCall('seed',kind,kind)).id;
 ids.unstored=(await fixtureCall('id','unstored')).id;
 const snapshots={};for(const kind of ['empty','native','web','corrupt'])snapshots[kind]=await fixtureCall('state',kind);
 const io={target:{environment:'isolated-local'},current:async()=>({...current}),checkInterrupted:()=>{},progress:()=>{},
  page:async cursor=>cursor?{result:[{id:ids.unstored,hasStoredData:false}]}:{result:Object.entries(ids).filter(([k])=>k!=='unstored').map(([,id])=>({id,hasStoredData:true})),result_info:{cursor:'next'}},
  upload:async scope=>{await writeFile(entry,maintenanceEntry({...scope,token,expiresAt:Date.now()+60000}));return maintenance;},
  deploy:async version=>{await start(entry);current={id:crypto.randomUUID(),version};},
  restore:async version=>{await start(fixture);current={id:crypto.randomUUID(),version};},
  call:maintenanceCall,save:async report=>{reports.push(structuredClone(report));},
 };
 await assert.rejects(runCleanup(parseArgs([]),io),/Some objects/);
 assert.equal(reports.at(-1).restored,true);assert.equal(reports.at(-1).results.find(r=>r.id===ids.empty).status,'candidate');
 for(const kind of ['empty','native','web','corrupt'])assert.deepEqual(await fixtureCall('state',kind),snapshots[kind]);
 await assert.rejects(runCleanup(parseArgs(['--apply']),io),/Some objects/);
 assert.equal(reports.at(-1).restored,true);
 assert.deepEqual(await fixtureCall('state','empty'),{tables:[],kv:[],alarm:null,sessions:null});
 for(const kind of ['native','web','corrupt'])assert.deepEqual(await fixtureCall('state',kind),snapshots[kind]);
 const force=await runCleanup(parseArgs(['--id',ids.corrupt,'--apply']),io);assert.equal(force.results[0].status,'deleted');
 assert.deepEqual(await fixtureCall('state','corrupt'),{tables:[],kv:[],alarm:null,sessions:null});
 const withNewRequest={...io,call:async id=>{
   const result=await maintenanceCall(id);assert.equal(result.status,'deleted');
   const created=await fetch(base+'/v1/sessions',{method:'POST',headers:{'x-webclip-user':'native','Content-Type':'application/json'},body:JSON.stringify({title:'web session'})});
   assert.equal(created.status,201,'ordinary business resumes in the same maintenance instance after deletion');
   return result;
 }};
 await runCleanup(parseArgs(['--id',ids.native,'--apply']),withNewRequest);
 const native=await fixtureCall('state','native');assert.equal(native.sessions.length,1);assert.notEqual(native.sessions[0].id,'native-session');
 assert.deepEqual(await fixtureCall('state','web'),snapshots.web);
 assert.deepEqual(await fixtureCall('state','unstored'),{tables:[],kv:[],alarm:null,sessions:null});
 assert.equal((await fetch(base+'/__maintenance/cleanup-do',{method:'POST'})).status,404,'restored entry has no maintenance route');
 await writeFile(join(artifacts,'result.json'),JSON.stringify({passed:true,cases:['preview preserves storage','bulk deletes empty SQL/KV/alarm','both session purposes preserved','unreadable schema skipped','explicit unreadable ID cleared','explicit nonempty ID cleared','business resumes after deletion','unstored object never initialized','original entry restored'],reports},null,2));
 console.log('DO cleanup isolated E2E passed: '+artifacts);
}finally{try{await worker?.stop();}finally{await rm(root,{recursive:true,force:true});}}
