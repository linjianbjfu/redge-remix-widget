import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {InMemoryFs} from 'just-bash/browser';
import {createPreviewTool} from './preview.ts';
import {openSession} from './session-factory.ts';
import {createModelRuntime} from './model.ts';

const preview={size:'fixed',viewport:{width:360,height:440},root:{x:0,y:0,width:360,height:440},syntaxError:null,errors:[],text:'0',extractedData:'{"count":0}',screenshotBytes:1,screenshotBase64:'AA==',sourceMode:'fixture'};
const runtime=()=>createModelRuntime({id:'preview-fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'fixture',defaultModel:'gpt-6.1-sol'});

test('default quota permits two calls, then rejects before any further render',async()=>{
  let rendered=0,exhausted=0;const tool=createPreviewTool({}, {},true,{render:async()=>{rendered++;return preview;},onExhausted:()=>{exhausted++;}});
  assert.equal((await tool.execute('one',{})).details.valid,true);
  const second=await tool.execute('two',{});assert.equal(second.details.valid,true);
  assert.match(second.content[0].text,/budget exhausted/);
  await assert.rejects(tool.execute('three',{}),/preview limit reached/);
  assert.equal(rendered,2);assert.equal(exhausted,1);
});

test('failed attempts consume quota and zero cannot render',async()=>{
  let rendered=0;const tool=createPreviewTool({}, {},false,{maxCount:1,render:async()=>{rendered++;throw new Error('renderer failed');}});
  await assert.rejects(tool.execute('one',{}),/preview failed/);await assert.rejects(tool.execute('two',{}),/limit reached/);
  const disabled=createPreviewTool({}, {},false,{maxCount:0,render:async()=>{rendered++;return preview;}});
  await assert.rejects(disabled.execute('zero',{}),/limit reached/);assert.equal(rendered,1);
});

test('parallel calls reserve quota synchronously and separate tools have independent budgets',async()=>{
  let rendered=0,release;const gate=new Promise(resolve=>{release=resolve;});
  const tool=createPreviewTool({}, {},false,{maxCount:2,render:async()=>{rendered++;await gate;return preview;}});
  const a=tool.execute('one',{}),b=tool.execute('two',{});
  try{await assert.rejects(tool.execute('three',{}),/limit reached/);assert.equal(rendered,2);}finally{release();}
  await Promise.all([a,b]);
  const another=createPreviewTool({}, {},false,{maxCount:1,render:async()=>{rendered++;return preview;}});
  await another.execute('independent',{});assert.equal(rendered,3);
});

test('zero disables registration and prompts while the default remains two',async t=>{
  const modelRuntime=await runtime();
  for(const count of [0,undefined]){
    const opened=await openSession({modelRuntime,providerId:'preview-fixture',modelId:'gpt-6.1-sol',fs:new InMemoryFs(),sessionId:'budget',history:[],browser:{},fixedCanvas:true,previewMaxCount:count});
    t.after(()=>opened.session.dispose());
    const tool=opened.session.getToolDefinition('preview_widget');
    if(count===0){assert.equal(tool,undefined);assert.doesNotMatch(opened.session.getActiveToolNames().join(),/preview_widget/);assert.match(opened.session.systemPrompt,/Browser preview is disabled/);}
    else{
      assert.ok(tool);await assert.rejects(tool.execute('one',{}),/preview failed/);await assert.rejects(tool.execute('two',{}),/preview failed/);
      assert.equal(opened.session.getActiveToolNames().includes('preview_widget'),false);
      await assert.rejects(tool.execute('three',{}),/limit reached/);
    }
  }
});

test('real SDK follow-up no longer offers preview after the final failed attempt',async t=>{
  const requests=[];const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const n=requests.length,delta=n<=2?{role:'assistant',tool_calls:[{index:0,id:'preview-'+n,type:'function',function:{name:'preview_widget',arguments:'{}'}}]}:{role:'assistant',content:'Finished without more checks'};
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const chunk of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:n<=2?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}])res.write('data: '+JSON.stringify(chunk)+'\n\n');res.end('data: [DONE]\n\n');
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const modelRuntime=await createModelRuntime({id:'loop-fixture',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'fixture',defaultModel:'gpt-6.1-sol'});
  const opened=await openSession({modelRuntime,providerId:'loop-fixture',modelId:'gpt-6.1-sol',fs:new InMemoryFs(),sessionId:'loop',history:[],browser:{},previewMaxCount:2});t.after(()=>opened.session.dispose());
  await opened.session.prompt('Generate and check the widget.');assert.equal(requests.length,3);
  const offers=req=>req.tools.some(t=>t.function.name==='preview_widget');
  assert.equal(offers(requests[0]),true);assert.equal(offers(requests[1]),true);assert.equal(offers(requests[2]),false);
});
