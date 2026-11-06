import {env, runInDurableObject} from 'cloudflare:test';
import {expect, it, vi} from 'vitest';
import {route} from './router.ts';
import {generationObjectName, type GenerationResult} from './generation.ts';
import type {UserAgentDO} from './do/user-agent-do.ts';

const input = {userQuery:'显示所选结果',url:'https://example.test/results?q=sample#section',pageTitle:'结果',htmlContent:'<html>结果 0</html>',input_image:'data:image/png;base64,AQID',history:[]};
const result: GenerationResult = {status:'Success',title:'结果',size:'fixed',width:360,height:440,extractScript:'(() => ({value:0}))()',widgetHtml:'<!doctype html><html></html>'};
const request = (body: unknown = input, headers = {}) => new Request('https://worker.test/v1/generate', {method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const object = () => env.AGENT.get(env.AGENT.idFromName(crypto.randomUUID()));

it('routes by the local tick modulo 20 and forwards only the two GEC fields', async () => {
  const names: string[] = [], forwarded: Request[] = [];
  const fake = {AGENT:{idFromName:(name: string) => {names.push(name); return name;},get:()=>({fetch:async (req: Request)=>{
    forwarded.push(req);return Response.json(result);
  }})}} as unknown as typeof env;
  for (let tick=0;tick<41;tick++) {
    expect((await route(request(input, {'Sec-MS-GEC':'token','Sec-MS-GEC-Version':'1-version',Authorization:'Bearer private',Cookie:'session=private','x-extra':'omit'}), fake, {} as ExecutionContext,tick)).status).toBe(200);
  }
  expect(new Set(names).size).toBe(20);
  expect(names[0]).toBe(names[20]);expect(names[0]).toBe(names[40]);expect(names[19]).toBe('generation-19');
  expect(generationObjectName(1001)).toBe('generation-1');
  expect(Object.fromEntries(forwarded[0]!.headers)).toEqual({'content-type':'application/json','sec-ms-gec':'token','sec-ms-gec-version':'1-version'});
  expect(await forwarded[0]!.json()).toEqual(input);
});

it('rejects unsupported methods before reaching a DO', async () => {
  const get=vi.fn();const fake={AGENT:{get}} as unknown as typeof env;
  const response=await route(new Request('https://test/v1/generate'),fake,{} as ExecutionContext);
  expect(response.status).toBe(405);expect(response.headers.get('allow')).toBe('POST');expect(get).not.toHaveBeenCalled();
});

it('returns JSON without server-side GEC or request schema validation and removes temporary data', async () => {
  const stub=object();let seen: unknown;
  await runInDurableObject(stub, async(instance: UserAgentDO)=>{
    instance.generationRunner=async(body,fs)=>{seen=body;await fs.writeFile('/source.html','private snapshot');return result;};
  });
  const body={...input,history:[{old:'ignored by generator'}],url:'not checked',input_image:'not checked'};
  const response=await stub.fetch(request(body,{'Sec-MS-GEC':'','Sec-MS-GEC-Version':'wrong'}));
  expect(response.status).toBe(200);expect(await response.json()).toEqual(result);expect(seen).toEqual(body);
  expect(response.headers.get('content-type')).toContain('application/json');expect(response.headers.get('cache-control')).toContain('no-store');
  await runInDurableObject(stub,async(instance: UserAgentDO)=>{
    for (const table of ['sessions','files','chunks']) expect(instance.sqlForTest.exec(`SELECT * FROM ${table}`).toArray()).toEqual([]);
  });
});

it('keeps concurrent requests pending and gives each a separate workspace in the same DO', async () => {
  await runInDurableObject(object(),async(instance: UserAgentDO)=>{
    let release!:()=>void, entered!:()=>void, starts=0, finished=0;
    const ready=new Promise<void>(resolve=>{entered=resolve;}), gate=new Promise<void>(resolve=>{release=resolve;});
    const ids: string[]=[];
    instance.generationRunner=async(body,fs,id)=>{
      ids.push(id);await fs.writeFile('/source.html',body.userQuery);
      if(++starts===2)entered();
      await gate;
      return {...result,title:await fs.readFile('/source.html')};
    };
    const a=instance.fetch(request({...input,userQuery:'A'})).then(async r=>{finished++;return r.json<GenerationResult>();});
    const b=instance.fetch(request({...input,userQuery:'B'})).then(async r=>{finished++;return r.json<GenerationResult>();});
    try {await ready;expect(finished).toBe(0);expect(new Set(ids).size).toBe(2);}
    finally {release();}
    expect((await Promise.all([a,b])).map(r=>r.title)).toEqual(['A','B']);
    expect(instance.sqlForTest.exec('SELECT * FROM sessions').toArray()).toEqual([]);
    expect(instance.sqlForTest.exec('SELECT * FROM files').toArray()).toEqual([]);
  });
});

it('returns an error and cleans files after generation fails, without initializing work for malformed JSON', async () => {
  const stub=object();let calls=0;
  await runInDurableObject(stub,async(instance: UserAgentDO)=>{
    instance.generationRunner=async(_body,fs)=>{calls++;await fs.writeFile('/source.html','private');throw new Error('private upstream error');};
  });
  const bad=await stub.fetch(new Request('https://test/v1/generate',{method:'POST',body:'{'}));
  expect(bad.status).toBe(400);expect(calls).toBe(0);
  const response=await stub.fetch(request());
  expect(response.status).toBe(500);expect(await response.json()).toEqual({status:'Error',error:'generation_failed'});
  expect(response.headers.get('cache-control')).toContain('no-store');
  await runInDurableObject(stub,async(instance: UserAgentDO)=>{
    expect(instance.sqlForTest.exec('SELECT * FROM sessions').toArray()).toEqual([]);
    expect(instance.sqlForTest.exec('SELECT * FROM files').toArray()).toEqual([]);
  });
});
