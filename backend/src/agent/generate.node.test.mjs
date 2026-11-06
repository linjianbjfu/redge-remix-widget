import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {InMemoryFs} from 'just-bash/browser';
import {generateWidget} from './generate.ts';
import {previewFiles,createPreviewTool} from './preview.ts';

const code='(() => ({count:Number(document.querySelector("b").textContent)}))()';
const html='<!doctype html><html><body><main id="widget-root"></main></body></html>';
const payload={userQuery:'显示结果',url:'https://example.test/results?q=sample#section',pageTitle:'结果',htmlContent:'<html><body><b>0</b></body></html>',input_image:'data:image/png;base64,AQID',history:[{role:'user',content:'MUST_NOT_RESTORE_HISTORY'}]};

test('direct preview uses its host canvas even when model metadata chooses a legacy size',async()=>{
  const fs=new InMemoryFs();await fs.mkdir('/out',{recursive:true});
  for(const [path,value] of [['/source.html',payload.htmlContent],['/out/extra.js',code],['/out/widget.html',html],['/out/meta.json','{"size":"large"}']])await fs.writeFile(path,value);
  assert.equal((await previewFiles(fs,true)).size,'fixed');assert.equal((await previewFiles(fs)).size,'large');
  assert.match(createPreviewTool({},fs,true).description,/360x440/);
});

test('direct generation reuses real pi tools with fixed design context, PNG and fresh history',async t=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    const parts=[];for await(const part of req)parts.push(part);requests.push(JSON.parse(Buffer.concat(parts).toString()));
    let delta,finish='tool_calls';
    const call=(name,args,index)=>({index,id:'tool-'+requests.length+'-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}});
    if(requests.length===1)delta={role:'assistant',tool_calls:[call('read',{path:'/source.html'},0),call('get_design_context',{pattern:'list',size:'fixed'},1)]};
    else if(requests.length===2)delta={role:'assistant',tool_calls:[call('write',{path:'/out/extra.js',content:code},0),call('write',{path:'/out/widget.html',content:html},1),call('write',{path:'/out/meta.json',content:'{"size":"fixed"}'},2)]};
    else {delta={role:'assistant',content:'Done'};finish='stop';}
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const chunk of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}])res.write('data: '+JSON.stringify(chunk)+'\n\n');
    res.end('data: [DONE]\n\n');
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const fs=new InMemoryFs();
  const result=await generateWidget({LLM_BASE_URL:'http://127.0.0.1:'+server.address().port+'/v1',LLM_API_KEY:'fixture',LLM_PROVIDER:'direct-fixture',BROWSER:{},PREVIEW_MAX_COUNT:'0'},fs,'direct-test',payload);
  assert.deepEqual(result,{status:'Success',title:'结果',size:'fixed',width:360,height:440,extractScript:code,widgetHtml:html});
  assert.equal(await fs.readFile('/source.html'),payload.htmlContent);
  const first=requests[0],serialized=JSON.stringify(first.messages);
  assert.match(serialized,/360 x 440/);assert.match(serialized,/q=sample#section/);assert.match(serialized,/data:image\/png;base64,AQID/);
  assert.doesNotMatch(serialized,/MUST_NOT_RESTORE_HISTORY/);
  const names=first.tools.map(t=>t.function.name);
  assert.equal(names.includes('preview_widget'),false);assert.match(serialized,/Browser preview is disabled/);
  for(const name of ['read','write','edit','bash','ls','find','get_design_context'])assert.ok(names.includes(name),name);
  const design=first.tools.find(t=>t.function.name==='get_design_context');
  assert.match(JSON.stringify(design.function.parameters.properties.size),/fixed/);
  assert.doesNotMatch(JSON.stringify(design.function.parameters.properties.size),/small|middle|large/);
  const designResult=requests[1].messages.find(m=>m.role==='tool'&&m.tool_call_id==='tool-1-1');
  assert.match(JSON.stringify(designResult),/360 x 440 portrait/);
});

test('a completed model answer without the generated files is a failure',async t=>{
  const server=createServer(async(req,res)=>{
    for await(const _ of req){}
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'No files'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  await assert.rejects(generateWidget({LLM_BASE_URL:'http://127.0.0.1:'+server.address().port+'/v1',LLM_API_KEY:'fixture'},new InMemoryFs(),'missing',{...payload,input_image:undefined}),/ENOENT|not found|does not exist/i);
});
