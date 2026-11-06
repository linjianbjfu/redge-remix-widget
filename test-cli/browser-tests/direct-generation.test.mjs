import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capturePage} from '../capture-page.mjs';
import {runGenerateCommand} from '../generate.mjs';
import {launchBrowser} from '../browser.mjs';
import {composeCaptureImage} from '../capture-images.mjs';

test('direct capture sends the processed DOM, title, source query/fragment and a PNG',async t=>{
  const root=await mkdtemp(join(tmpdir(),'direct-browser-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let received;
  const server=createServer(async(req,res)=>{
    if(req.url.startsWith('/source')){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>测试结果</title><p>Count <b>0</b></p>');return;
    }
    if(req.url!=='/v1/generate'||req.method!=='POST'){res.writeHead(404).end();return;}
    const parts=[];for await(const part of req)parts.push(part);received=JSON.parse(Buffer.concat(parts).toString());
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'Success',extractScript:'(() => ({count:0}))()',widgetHtml:'<!doctype html><html></html>',size:'fixed',width:360,height:440}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base='http://127.0.0.1:'+server.address().port,url=base+'/source?q=sample#section';
  const outcome=await runGenerateCommand(['显示结果','--url',url,'--out',join(root,'widget')],{
    env:{WEBCLIP_URL:base,WEBCLIP_GEC:'token',WEBCLIP_GEC_VERSION:'1-v'},report:()=>{},
    capture:(options,config)=>capturePage(options,{...config,headless:true}),
  });
  assert.equal(received.url,url);assert.equal(received.pageTitle,'测试结果');assert.equal(received.userQuery,'显示结果');
  assert.match(received.htmlContent,/<b>0<\/b>/);assert.match(received.input_image,/^data:image\/png;base64,/);assert.deepEqual(received.history,[]);
  assert.deepEqual(JSON.parse(await readFile(join(outcome.out,'meta.json'),'utf8')),{size:'fixed'});
  assert.equal(JSON.parse(await readFile(join(outcome.out,'capture/capture.json'),'utf8')).version,2);
  assert.equal(await readFile(join(outcome.out,'capture/source.html'),'utf8'),received.htmlContent);
});

test('direct PNG capture refuses oversized pixels instead of switching to JPEG',async t=>{
  const owned=await launchBrowser({headless:true});t.after(()=>owned.close());
  const page=await owned.browser.newPage();
  const tiles=await page.evaluate(()=>Array.from({length:4},(_,tile)=>{
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=768;
    const context=canvas.getContext('2d'),image=context.createImageData(768,768);let seed=1234567+tile;
    for(let i=0;i<image.data.length;i+=4){for(let channel=0;channel<3;channel++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;image.data[i+channel]=seed&255;}image.data[i+3]=255;}
    context.putImageData(image,0,0);return{id:'r'+tile,data:canvas.toDataURL('image/png').split(',')[1]};
  }));
  assert.equal((await composeCaptureImage(page,tiles,'regions',{width:1536,height:1536})).mimeType,'image/jpeg');
  await assert.rejects(composeCaptureImage(page,tiles,'regions',{width:1536,height:1536},true),/2 MiB/);
});
