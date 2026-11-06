import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryFs} from 'just-bash/browser';
import {createModelRuntime,resolveProvider} from './model.ts';
import {openSession} from './session-factory.ts';

const config={id:'model-fixture',baseUrl:'https://fixture.invalid/v1',apiKey:'fixture',defaultModel:'gpt-5.6-luna'};
for(const [id,contextWindow] of [['gpt-6.1-sol',1050000],['gpt-6-luna',1000000],['gpt-5.6-luna',1050000],['mai-code-2-flash',1050000]]){
  test('registers '+id+' with its declared limits and opens the real SDK session',async t=>{
    const runtime=await createModelRuntime(config),model=runtime.getModel(config.id,id);
    assert.ok(model,'configured gateway model must be registered');
    assert.equal(model.contextWindow,contextWindow);assert.equal(model.maxTokens,128000);
    assert.equal(model.reasoning,true);assert.deepEqual(model.input,['text','image']);
    assert.equal(model.compat.supportsDeveloperRole,false);
    const opened=await openSession({modelRuntime:runtime,providerId:config.id,modelId:id,fs:new InMemoryFs(),sessionId:'models',history:[],fixedCanvas:true});
    t.after(()=>opened.session.dispose());
    assert.ok(opened.session.getActiveToolNames().includes('write'));
    assert.match(opened.session.systemPrompt,/360 x 440/);
  });
}

test('preserves configured selection, fallback and credential failures',()=>{
  const env={LLM_BASE_URL:config.baseUrl,LLM_API_KEY:config.apiKey};
  assert.equal(resolveProvider(env).defaultModel,'gpt-6.1-sol');
  for(const id of ['gpt-6.1-sol','gpt-6-luna','gpt-5.6-luna','mai-code-2-flash'])assert.equal(resolveProvider({...env,DEFAULT_MODEL:id}).defaultModel,id);
  assert.throws(()=>resolveProvider({}),/must be configured/);
  assert.throws(()=>resolveProvider({LLM_BASE_URL:config.baseUrl}),/must be configured/);
  assert.throws(()=>resolveProvider({LLM_API_KEY:config.apiKey}),/must be configured/);
});

test('unknown models remain unavailable and fail before a model request',async()=>{
  const runtime=await createModelRuntime(config);assert.equal(runtime.getModel(config.id,'unknown'),undefined);
  await assert.rejects(openSession({modelRuntime:runtime,providerId:config.id,modelId:'unknown',fs:new InMemoryFs(),sessionId:'unknown',history:[]}),/not registered/);
});
