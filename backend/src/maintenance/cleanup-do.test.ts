import {env,runInDurableObject} from 'cloudflare:test';
import {it,expect,vi} from 'vitest';
import type {UserAgentDO,Env} from '../do/user-agent-do.ts';
import {cleanupStorage,inspectStorage,handleCleanup,MaintenanceUserAgentDO,type CleanupPolicy} from './cleanup-do.ts';
const policy=(id:string):CleanupPolicy=>({token:'test-only-token',expiresAt:Date.now()+60000,ids:[id],forceId:null,apply:false});
const object=()=>env.AGENT.get(env.AGENT.idFromName(crypto.randomUUID()));
it('previews without deleting, protects both purposes, rechecks new sessions, deletes all SQL/KV and alarm',async()=>{
 const stub=object();await runInDurableObject(stub,async(i:UserAgentDO,ctx)=>{
  expect(await cleanupStorage(ctx,false,false,()=>false)).toMatchObject({status:'candidate',sessions:0});
  i.storeForTest.createSession('web');expect(await cleanupStorage(ctx,false,true,()=>false)).toMatchObject({status:'preserved',sessions:1});
  i.sqlForTest.exec("INSERT INTO sessions(id,purpose,created_at,updated_at) VALUES('native','widgee',1,1)");
  expect(await cleanupStorage(ctx,false,true,()=>false)).toMatchObject({status:'preserved',sessions:2});
  await ctx.storage.put('private','data');await ctx.storage.setAlarm(Date.now()+3600000);
  expect(await cleanupStorage(ctx,true,true,()=>false)).toMatchObject({status:'deleted'});
  expect(await ctx.storage.list()).toEqual(new Map());expect(await ctx.storage.getAlarm()).toBeNull();
  expect(ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").toArray()).toEqual([]);
 });
});
it('unknown/unreadable schemas are skipped in bulk but explicit ID can clear them',async()=>{
 const stub=object();await runInDurableObject(stub,async(i:UserAgentDO,ctx)=>{
  i.sqlForTest.exec('DROP TABLE sessions');await ctx.storage.put('keep','value');
  expect(await cleanupStorage(ctx,false,true,()=>false)).toMatchObject({status:'failed'});expect(await ctx.storage.get('keep')).toBe('value');
  expect(await cleanupStorage(ctx,true,false,()=>false)).toMatchObject({status:'candidate',sessions:null});
  expect(await cleanupStorage(ctx,true,true,()=>false)).toMatchObject({status:'deleted'});
  expect(await inspectStorage(ctx.storage)).toBe(0);
 });
});
it('live delegated work and orphan running turns are not deleted by the automatic scan',async()=>{
 const stub=object();await runInDurableObject(stub,async(i:UserAgentDO,ctx)=>{
  expect(await cleanupStorage(ctx,true,true,()=>true)).toEqual({status:'busy'});
  i.sqlForTest.exec("INSERT INTO turns(session_id,turn_id,status,started_at,last_progress_at,prompt) VALUES('gone','t','running',1,1,'')");
  expect(await cleanupStorage(ctx,false,true,()=>false)).toEqual({status:'busy'});
 });
});
it('failed deletion remains explicit',async()=>{
 const ctx={blockConcurrencyWhile:async(fn:()=>Promise<unknown>)=>fn(),storage:{deleteAll:async()=>{throw new Error('secret');}}} as unknown as DurableObjectState;
 expect(await cleanupStorage(ctx,true,true,()=>false)).toEqual({status:'failed',error:'check_or_delete_failed'});
});
it('maintenance wrapper does not initialize storage, enforces scope, and resumes business after deleting',async()=>{
 const stub=object();await runInDurableObject(stub,async(_i:UserAgentDO,ctx)=>{
  await ctx.storage.deleteAll();const p=policy(ctx.id.toString());p.apply=true;
  const wrapper=new MaintenanceUserAgentDO(ctx,env,p);
  expect(await wrapper.cleanup('bad')).toMatchObject({status:'failed'});
  expect(await wrapper.cleanup(p.token)).toMatchObject({status:'deleted'});
  await wrapper.alarm();expect(await inspectStorage(ctx.storage)).toBe(0);
  expect((await wrapper.fetch(new Request('https://test/v1/sessions'))).status).toBe(200);
  expect(await wrapper.cleanup(p.token)).toEqual({status:'busy'});
  expect(ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='sessions'").toArray()).toHaveLength(1);
 });
});
it('authenticated POST only, unlisted IDs and expired credentials never reach a DO; callers cannot enable deletion',async()=>{
 const id='a'.repeat(64), p=policy(id), cleanup=vi.fn(async()=>({status:'candidate'}));
 const fake={AGENT:{idFromString:(s:string)=>s,get:()=>({cleanup})}} as unknown as Env;
 const req=(body:unknown,token=p.token,method='POST')=>new Request('https://test/__maintenance/cleanup-do',{
  method,headers:{Authorization:'Bearer '+token},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 expect((await handleCleanup(req({id},'bad'),fake,p)).status).toBe(401);
 expect((await handleCleanup(req(null,p.token,'GET'),fake,p)).status).toBe(405);
 expect((await handleCleanup(req({id:'b'.repeat(64)}),fake,p)).status).toBe(400);
 expect((await handleCleanup(req(null),fake,p)).status).toBe(400);
 expect((await handleCleanup(req({id}),fake,{...p,expiresAt:0})).status).toBe(410);
 expect(cleanup).not.toHaveBeenCalled();
 expect((await handleCleanup(req({id,apply:true,force:true}),fake,p)).status).toBe(200);
 expect(cleanup).toHaveBeenCalledWith(p.token);expect(p.apply).toBe(false);
});
it('lookalike internal table prefixes are not treated as an empty database',async()=>{
 const stub=object();await runInDurableObject(stub,async(_i:UserAgentDO,ctx)=>{
  await ctx.storage.deleteAll();ctx.storage.sql.exec('CREATE TABLE xcf_user_data(value TEXT)');
  expect(await cleanupStorage(ctx,false,true,()=>false)).toMatchObject({status:'failed'});
  expect(ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='xcf_user_data'").toArray()).toHaveLength(1);
 });
});
