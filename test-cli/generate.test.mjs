import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,mkdir,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {generationHeaders,generationResult,requestGeneration,saveGeneration,parseGenerateArgs,runGenerateCommand,gecProvider,GENERATION_TIMEOUT_MS} from './generate.mjs';

const good = {status:'Success',extractScript:'(() => ({count:0}))()',widgetHtml:'<!doctype html><html>结果</html>',title:'结果',size:'fixed',width:360,height:440};
const headers = () => ({'Sec-MS-GEC':'token','Sec-MS-GEC-Version':'1-version',Authorization:'private',Cookie:'private',extra:'private'});
const input = {userQuery:'显示所选结果',url:'https://example.test/results?q=sample#section',pageTitle:'结果',htmlContent:'<html>0</html>',history:[]};

test('executable providers run afresh and failures do not expose their output', {skip:process.platform==='win32'?'This fixture uses a POSIX executable shebang':false},async t=>{
  const root=await mkdtemp(join(tmpdir(),'gec-provider-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const command=join(root,'provider');
  await writeFile(command,`#!${process.execPath}\nimport fs from 'node:fs'; const path=${JSON.stringify(join(root,'count'))};let n=0;try{n=Number(fs.readFileSync(path,'utf8'));}catch{}fs.writeFileSync(path,String(++n));console.log(JSON.stringify({'Sec-MS-GEC':'token-'+n,'Sec-MS-GEC-Version':'1-v',Authorization:'discard'}));`);await chmod(command,0o700);
  const provider=gecProvider({command});assert.equal((await provider())['Sec-MS-GEC'],'token-1');assert.equal((await provider())['Sec-MS-GEC'],'token-2');
  await writeFile(command,`#!${process.execPath}\nconsole.error('private-provider-output');process.exit(1);`);
  await assert.rejects(provider(),error=>error.message==='GEC provider command failed');
  await writeFile(command,`#!${process.execPath}\nconsole.log('private-invalid-json');`);
  await assert.rejects(provider(),error=>error.message==='GEC provider must output a JSON object');
});

test('GEC gating rejects missing/blank tokens and malformed versions before sending',async()=>{
  for(const provided of [null,{}, {'Sec-MS-GEC':' ','Sec-MS-GEC-Version':'1-v'}, {'Sec-MS-GEC':'t','Sec-MS-GEC-Version':'1-'},
    {'Sec-MS-GEC':'t','Sec-MS-GEC-Version':'1- '}, {'Sec-MS-GEC':'t','Sec-MS-GEC-Version':'2-v'}, {'Sec-MS-GEC':1,'Sec-MS-GEC-Version':'1-v'}]){
    let sent=0;
    await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,getHeaders:async()=>provided,fetchImpl:async()=>{sent++;return Response.json(good);}}),/GEC provider/);
    assert.equal(sent,0);
  }
  assert.deepEqual(generationHeaders(new Headers(headers())),{'Content-Type':'application/json','Sec-MS-GEC':'token','Sec-MS-GEC-Version':'1-version','Cache-Control':'no-store, no-cache',Pragma:'no-cache'});
});

test('HTTP timing starts at dispatch, includes body reading and reports once after retries',async()=>{
  let clock=0, calls=0;const timing=[];
  const result=await requestGeneration({baseUrl:'https://worker.test',input,retries:1,now:()=>clock,onTiming:value=>timing.push(value),
    getHeaders:async()=>{clock+=1000;return headers();},fetchImpl:async()=>{
      clock+=100;
      if(++calls===1)return new Response('',{status:503});
      return {ok:true,text:async()=>{clock+=200;return JSON.stringify(good);}};
    }});
  assert.deepEqual(result,good);assert.deepEqual(timing,[{elapsedMs:1400,attempts:2}]);
});

test('HTTP timing reports failure and a zero-start clock, but not errors before sending',async()=>{
  const timing=[];let clock=0;
  await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,getHeaders:headers,now:()=>clock,onTiming:value=>timing.push(value),fetchImpl:async()=>{clock=250;throw new Error('network');}}),/network/);
  assert.deepEqual(timing,[{elapsedMs:250,attempts:1}]);
  const before=[];
  await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,getHeaders:async()=>({}),now:()=>0,onTiming:value=>before.push(value)}),/GEC provider/);
  assert.deepEqual(before,[]);
});

test('each retry gets fresh provider headers and preserves URL/UTF-8 without OAuth, cookies or cache',async()=>{
  let providers=0;const requests=[];
  const result=await requestGeneration({baseUrl:'https://worker.test/',input:{...input,history:[{private:'not supported'}]},retries:2,
    getHeaders:async()=>({...headers(),'Sec-MS-GEC':'token-'+(++providers)}),fetchImpl:async(url,init)=>{
      requests.push({url,init});if(requests.length===1)return new Response('busy',{status:503});
      if(requests.length===2)throw new Error('network');return Response.json(good);
    }});
  assert.deepEqual(result,good);assert.equal(providers,3);
  for(const [index,{url,init}] of requests.entries()){
    assert.equal(url,'https://worker.test/v1/generate');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');
    assert.equal(init.redirect,'error');assert.equal(init.headers['Sec-MS-GEC'],'token-'+(index+1));
    assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.Cookie,undefined);assert.equal(init.headers.extra,undefined);
    assert.deepEqual(JSON.parse(init.body),input);
  }
});

test('retries are bounded, fresh invalid GEC stops retries, and 4xx or malformed successes are final',async()=>{
  for(const status of [400,401,403]){
    let calls=0;await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,getHeaders:headers,retries:2,fetchImpl:async()=>{calls++;return new Response('',{status});}}),new RegExp('HTTP '+status));assert.equal(calls,1);
  }
  let providers=0,sent=0;
  await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,retries:2,getHeaders:()=>++providers===1?headers():{},fetchImpl:async()=>{sent++;return new Response('',{status:429});}}),/GEC provider/);
  assert.equal(sent,1);assert.equal(providers,2);
  let failed=0;await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,getHeaders:headers,retries:2,fetchImpl:async()=>{failed++;throw new Error('network');}}),/network/);assert.equal(failed,3);
  for(const body of ['not json',JSON.stringify({...good,status:'success'})]){
    let calls=0;await assert.rejects(requestGeneration({baseUrl:'https://worker.test',input,getHeaders:headers,retries:2,fetchImpl:async()=>{calls++;return new Response(body,{status:200});}}));assert.equal(calls,1);
  }
  let bodies=0;
  await requestGeneration({baseUrl:'https://worker.test',input,getHeaders:headers,retries:1,fetchImpl:async()=>{
    if(++bodies===1)return new Response(new ReadableStream({start(controller){controller.error(new Error('body network failure'));}}));
    return Response.json(good);
  }});
  assert.equal(bodies,2);
});

test('response text is required and optional metadata follows the permissive client rules',()=>{
  for(const value of [null,[],{}, {...good,status:'success'},...['extractScript','widgetHtml'].flatMap(key=>[null,'',' \n','a\0b','\ud800'].map(text=>({...good,[key]:text})))])assert.throws(()=>generationResult(value));
  const result=generationResult({...good,title:1,size:null,width:1.5,height:'440'});
  assert.equal(result.title,'');assert.equal(result.size,'');assert.equal(result.width,0);assert.equal(result.height,0);
  const arbitrary=generationResult({...good,size:'unrestricted',width:-9,height:0});
  assert.equal(arbitrary.size,'unrestricted');assert.equal(arbitrary.width,-9);assert.equal(arbitrary.height,0);
});

test('long-request timeout and caller cancellation abort real HTTP reads',async t=>{
  const server=createServer(()=>{});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const baseUrl='http://127.0.0.1:'+server.address().port;
  assert.equal(GENERATION_TIMEOUT_MS,600000);
  await assert.rejects(requestGeneration({baseUrl,input,getHeaders:headers,timeoutMs:30}),/abort|timeout/i);
  const stop=new AbortController();let sent=0;stop.abort();
  await assert.rejects(requestGeneration({baseUrl,input,getHeaders:headers,signal:stop.signal,fetchImpl:()=>{sent++;}}),/abort/i);
  assert.equal(sent,0);
});

test('CLI argument validation and saving preserve unrelated runtime files and original response fields',async t=>{
  const root=await mkdtemp(join(tmpdir(),'direct-save-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const args of [[],['go','--file','snapshot.html'],['--json','r.json','--url','https://a.test'],['--json','r.json','--retries','6'],['--json','r.json','--timeout-ms','0'],['--json','r.json','--timeout-ms','2147483648'],['--json']])assert.throws(()=>parseGenerateArgs(args));
  assert.equal(parseGenerateArgs(['--help']).help,true);
  const out=join(root,'widget');await mkdir(out);await writeFile(join(out,'data.json'),'preserve');
  await saveGeneration(good,out);
  assert.equal(await readFile(join(out,'data.json'),'utf8'),'preserve');
  assert.deepEqual(JSON.parse(await readFile(join(out,'meta.json'),'utf8')),{size:'fixed'});
  assert.deepEqual(JSON.parse(await readFile(join(out,'response.json'),'utf8')),good);
  assert.equal(await readFile(join(out,'extra.js'),'utf8'),good.extractScript);
  assert.deepEqual((await readdir(root)).sort(),['widget']);
  const blocked=join(root,'blocked');await writeFile(blocked,'file');await assert.rejects(saveGeneration(good,blocked));
  assert.deepEqual((await readdir(root)).sort(),['blocked','widget']);
});

test('actual generate CLI posts raw JSON and saves the direct response without a user identifier',async t=>{
  const root=await mkdtemp(join(tmpdir(),'direct-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let fail=false;const received=[];const server=createServer(async(req,res)=>{
    const parts=[];for await(const part of req)parts.push(part);received.push({url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(parts).toString())});
    res.writeHead(fail?503:200,{'content-type':'application/json'});res.end(JSON.stringify(fail?{status:'Error'}:good));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const json=join(root,'request.json'),out=join(root,'widget');await writeFile(json,JSON.stringify(input));
  const {stdout}=await promisify(execFile)(process.execPath,[resolve('test-cli/index.mjs'),'generate','--json',json,'--out',out],{
    env:{...process.env,WEBCLIP_URL:'http://127.0.0.1:'+server.address().port,WEBCLIP_GEC:'token',WEBCLIP_GEC_VERSION:'1-version'},timeout:10000,
  });
  assert.match(stdout,/Request elapsed: \d+\.\d{3}s/);assert.match(stdout,/Saved widget:/);assert.equal(received[0].url,'/v1/generate');assert.deepEqual(received[0].body,input);
  assert.equal(received[0].headers.authorization,undefined);assert.equal(received[0].headers.cookie,undefined);assert.equal(received[0].headers['x-webclip-user'],undefined);
  assert.equal(await readFile(join(out,'widget.html'),'utf8'),good.widgetHtml);
  assert.equal(await readFile(join(out,'capture/source.html'),'utf8'),input.htmlContent);
  assert.equal(JSON.parse(await readFile(join(out,'capture/capture.json'),'utf8')).pageUrl,input.url);
  fail=true;
  await assert.rejects(promisify(execFile)(process.execPath,[resolve('test-cli/index.mjs'),'generate','--json',json,'--out',join(root,'failed')],{
    env:{...process.env,WEBCLIP_URL:'http://127.0.0.1:'+server.address().port,WEBCLIP_GEC:'token',WEBCLIP_GEC_VERSION:'1-version'},timeout:10000,
  }),error=>{
    assert.match(error.stdout,/Request elapsed: \d+\.\d{3}s/);assert.doesNotMatch(error.stdout,/Saved widget:/);assert.match(error.stderr,/HTTP 503/);return true;
  });
});

test('capture cancellation sends nothing and cleans capture resources on a request failure',async()=>{
  let disposed=0;const env={WEBCLIP_URL:'https://unused.test'};
  assert.equal(await runGenerateCommand(['go','--url','https://a.test'],{env,capture:async()=>null,report:()=>{}}),undefined);
  const root=await mkdtemp(join(tmpdir(),'direct-capture-'));
  try{
    const source=join(root,'source.html');await writeFile(source,'<html>source</html>');
    await assert.rejects(runGenerateCommand(['go','--url','https://a.test'],{env,capture:async(_options,config)=>{
      assert.equal(config.pngOnly,true);return{capture:{pageUrl:'https://a.test?q=1#x',images:[]},files:[source],pageTitle:'标题',dispose:async()=>{disposed++;}};
    },report:()=>{}}),/GEC provider/);
    assert.equal(disposed,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
