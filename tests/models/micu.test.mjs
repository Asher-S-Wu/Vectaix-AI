import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getModelConnection, getPublicModels } from '../../lib/server/models/service.js';

process.env.MONGO_URI='mongodb://127.0.0.1:27017/unused-micu-tests';
const { runConfiguredChat, normalizeProviderError }=await import('../../lib/server/providers/directChat.js');

const models=[
  ['gpt-6-astra','MICU_OPENAI_API_KEY','responses','gpt-6-astra','/v1/responses'],
  ['claude-opus-5-5','MICU_ANTHROPIC_API_KEY','anthropic','claude-opus-5-5','/v1/messages'],
  ['google/gemini-3.8-flash','MICU_GOOGLE_API_KEY','gemini','gemini-3.8-flash','/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse'],
  ['grok-4.6','MICU_XAI_API_KEY','responses','grok-4.6','/v1/responses'],
  ['kimi-k3','MICU_MOONSHOT_API_KEY','chat-completions','kimi-k3','/v1/chat/completions'],
];
const base={messages:[{role:'user',content:'你好'}],system:'用中文回答',onText(){},onThought(){}};
function stream(events) {
  return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
function completed(protocol) {
  if(protocol==='responses') {
    const item={id:'message',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'完成',annotations:[]}]};
    return stream([{type:'response.output_text.delta',delta:'完成'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response',status:'completed',usage:{input_tokens:10,output_tokens:2}}}]);
  }
  if(protocol==='anthropic') return stream([{type:'message_start',message:{id:'response',usage:{input_tokens:10,cache_read_input_tokens:3,cache_creation_input_tokens:2}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'完成'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},{type:'message_stop'}]);
  if(protocol==='gemini') return stream([{responseId:'response',candidates:[{content:{parts:[{text:'完成',thoughtSignature:'micu-signature'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,thoughtsTokenCount:3,cachedContentTokenCount:4}}]);
  return stream([{id:'response',choices:[{index:0,delta:{content:'完成'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2}}]);
}
function toolReply(protocol, usage) {
  if(protocol==='responses') return stream([
    {type:'response.output_item.done',output_index:0,item:{type:'reasoning',id:'reasoning',encrypted_content:'micu-only'}},
    {type:'response.output_item.done',output_index:1,item:{type:'function_call',call_id:'call-1',name:'lookup',arguments:'{"query":"测试"}'}},
    {type:'response.completed',response:{id:'tool-response',status:'completed',usage}},
  ]);
  if(protocol==='chat-completions') return stream([{id:'tool-response',choices:[{index:0,delta:{reasoning_content:'先查询',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'lookup',arguments:'{"query":"测试"}'}}]},finish_reason:'tool_calls'}],usage}]);
  if(protocol==='anthropic') return stream([
    {type:'message_start',message:{id:'tool-response',usage:{input_tokens:20}}},
    {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'call-1',name:'lookup',input:{query:'测试'}}},
    {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:4}},
    {type:'message_stop'},
  ]);
  return stream([{responseId:'tool-response',candidates:[{content:{parts:[{functionCall:{id:'call-1',name:'lookup',args:{query:'测试'}},thoughtSignature:'tool-signature'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:4}}]);
}
const lookupTool={name:'lookup',description:'查询',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}};
test('五个模型仅使用各自 KEY，公开目录不包含认证信息',async t=>{
  const keys=[...models.map(row=>row[1]),'MICU_OPENAI_IMAGE_API_KEY','OPENROUTER_API_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys) { if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]; }});
  process.env.MICU_OPENAI_IMAGE_API_KEY='image-secret';process.env.OPENROUTER_API_KEY='old-secret';
  for(const [,key] of models)process.env[key]=`secret-${key}`;
  const providerIds=new Set();
  for(const [id,key,protocol,upstream] of models) {
    const connection=await getModelConnection(id);
    assert.equal(connection.provider.apiKey,`secret-${key}`);
    assert.equal(connection.provider.protocol,protocol);
    assert.equal(connection.model.upstreamModel,upstream);
    providerIds.add(connection.provider.id);
    delete process.env[key];
    await assert.rejects(getModelConnection(id),error=>error.status===503&&error.message.includes(connection.model.name));
    for(const [other,otherKey] of models.filter(row=>row[0]!==id))assert.equal((await getModelConnection(other)).provider.apiKey,`secret-${otherKey}`);
    process.env[key]=`secret-${key}`;
  }
  assert.equal(providerIds.size,5);
  const catalog=JSON.stringify(await getPublicModels());
  assert.ok(!/secret-|Authorization|User-Agent|keyEnv|apiKey/.test(catalog));
});

for(const [id,key,protocol,upstream,path] of models) {
  test(`${id} 使用 Micu 对应协议、认证和思考参数`,async t=>{
    const saved=process.env[key];process.env[key]='model-secret';
    t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
    const connection=await getModelConnection(id);
    const requests=[];
    const fetchImpl=async(url,init)=>{requests.push({url:String(url),headers:new Headers(init.headers),body:JSON.parse(init.body)});return completed(protocol);};
    const result=await runConfiguredChat({...base,model:id,fetchImpl},connection);
    const request=requests[0];
    assert.equal(request.url,`https://www.micuapi.ai${path}`);
    assert.equal(request.headers.get('authorization'),'Bearer model-secret');
    assert.equal(request.body.stream,protocol==='gemini'?undefined:true);
    assert.equal(result.text,'完成');
    const state=result.providerState[protocol==='chat-completions'?'chatCompletions':protocol];
    assert.equal(state.providerId,connection.provider.id);
    assert.equal(state.model,id);
    if(protocol!=='gemini')assert.equal(request.body.model,upstream);
    if(id==='gpt-6-astra') {
      assert.match(request.headers.get('user-agent'),/^codex_cli_rs\//);
      assert.equal(request.body.reasoning.effort,'max');
      assert.equal(request.body.store,false);
    } else if(protocol==='anthropic') {
      assert.match(request.headers.get('user-agent'),/^claude-cli\//);
      assert.equal(request.headers.get('anthropic-version'),'2023-06-01');
      assert.deepEqual(request.body.thinking,{type:'adaptive',display:'summarized'});
      assert.equal(request.body.output_config.effort,'max');
      assert.deepEqual(request.body.cache_control,{type:'ephemeral'});
      assert.equal(request.body.reasoning,undefined);
      assert.equal(result.usageRecords[0].usage.input_tokens,15);
    } else if(protocol==='gemini') {
      assert.deepEqual(request.body.generationConfig.thinkingConfig,{thinkingLevel:'high',includeThoughts:true});
      assert.equal(request.body.generationConfig.maxOutputTokens,65536);
      assert.equal(result.usageRecords[0].usage.output_tokens,5);
    } else if(id==='grok-4.6') {
      assert.equal(request.body.reasoning.effort,'high');
      assert.equal(request.body.include,undefined);
    } else {
      assert.match(request.headers.get('user-agent'),/^Mozilla\//);
      assert.equal(request.body.max_tokens,131072);
      assert.equal(request.body.max_completion_tokens,undefined);
      assert.equal(request.body.stream_options.include_usage,true);
    }
  });
  test(`${id} 上游认证报错不包含 KEY 或认证请求头`,async t=>{
    const saved=process.env[key];process.env[key]='never-log-model-secret';
    t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
    const connection=await getModelConnection(id);
    let attempts=0;
    await assert.rejects(runConfiguredChat({...base,model:id,fetchImpl:async()=>{attempts++;return Response.json({error:{message:'Authorization: Bearer never-log-model-secret',type:'authentication_error',code:'invalid_api_key'}},{status:401});}},connection).catch(error=>{throw normalizeProviderError(error);}),error=>{
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`,/never-log-model-secret|Authorization|Bearer/);
      return true;
    });
    assert.equal(attempts,1);
  });
  test(`${id} 保留图片输入`,async t=>{
    const saved=process.env[key];process.env[key]='image-input-secret';
    t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
    const connection=await getModelConnection(id);
    let body;
    await runConfiguredChat({...base,model:id,messages:[{role:'user',content:[{type:'text',text:'描述这张图片'},{type:'image_url',image_url:{url:'data:image/png;base64,aW1hZ2U='}}]}],fetchImpl:async(url,init)=>{body=JSON.parse(init.body);return completed(protocol);}},connection);
    const part=(protocol==='responses'?body.input[0].content:protocol==='gemini'?body.contents[0].parts:body.messages.at(-1).content)[1];
    if(protocol==='responses')assert.deepEqual(part,{type:'input_image',image_url:'data:image/png;base64,aW1hZ2U='});
    else if(protocol==='anthropic')assert.deepEqual(part,{type:'image',source:{type:'base64',media_type:'image/png',data:'aW1hZ2U='}});
    else if(protocol==='gemini')assert.deepEqual(part,{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}});
    else assert.deepEqual(part,{type:'image_url',image_url:{url:'data:image/png;base64,aW1hZ2U='}});
  });

  test(`${id} 续聊仅复用同渠道的原生状态`,async t=>{
    const saved=process.env[key];process.env[key]='model-secret';
    t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
    const connection=await getModelConnection(id);
    const stateKey=protocol==='chat-completions'?'chatCompletions':protocol;
    const requests=[];
    const fetchImpl=async(url,init)=>{requests.push(JSON.parse(init.body));return completed(protocol);};
    const native=protocol==='responses'?{items:[{type:'reasoning',id:'private-item',encrypted_content:'channel-only'}]}:
      {messages:[protocol==='gemini'?{role:'model',parts:[{text:'原生内容',thoughtSignature:'channel-only'}]}:{role:'assistant',content:'原生内容',...(protocol==='chat-completions'?{reasoning_content:'channel-only'}:{})}]};
    for(const [providerId,stateModel,protocolKey,reuse] of [
      [undefined,id,stateKey,false],['openrouter',id,stateKey,false],
      [connection.provider.id,'other-model',stateKey,false],
      [connection.provider.id,id,'other-protocol',false],
      [connection.provider.id,id,stateKey,true],
    ]) {
      const state={model:stateModel,...native,...(providerId?{providerId}:{})};
      await runConfiguredChat({...base,model:id,fetchImpl,messages:[{role:'user',content:'之前的问题'},{role:'assistant',content:'可见回答',providerState:{[protocolKey]:state}},{role:'user',content:'继续'}]},connection);
      const payload=JSON.stringify(requests.at(-1));
      assert.equal(payload.includes('可见回答'),!reuse);
      assert.equal(payload.includes('原生内容')||payload.includes('channel-only'),reuse);
    }
  });
  test(`${id} 工具调用逐轮记录用量，并保留完整续聊记录`,async t=>{
    const saved=process.env[key];process.env[key]='tool-secret';
    t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
    const connection=await getModelConnection(id);
    const requests=[],passes=[],records=[],texts=[],calls=[];
    const usage=protocol==='chat-completions'?{prompt_tokens:20,completion_tokens:4}:{input_tokens:20,output_tokens:4};
    const fetchImpl=async(url,init)=>{requests.push(JSON.parse(init.body));return requests.length===1?toolReply(protocol,usage):completed(protocol);};
    const result=await runConfiguredChat({...base,model:id,fetchImpl,tools:[lookupTool],executeTool:async call=>{calls.push(call);return '查询结果';},onText:text=>texts.push(text),onUsageRecord:record=>records.push(record),onPassComplete:pass=>passes.push(pass)},connection);
    assert.equal(requests.length,2);
    assert.equal(calls.length,1);
    assert.equal(calls[0].name,'lookup');
    assert.deepEqual(JSON.parse(calls[0].arguments),{query:'测试'});
    assert.match(JSON.stringify(requests[1]),/查询结果/);
    assert.equal(passes.length,2);
    assert.equal(records.length,2);
    assert.equal(result.usageRecords.length,2);
    assert.equal(texts.join(''),'完成');
    await runConfiguredChat({...base,model:id,fetchImpl,messages:[...base.messages,{role:'assistant',content:result.text,providerState:result.providerState},{role:'user',content:'继续'}]},connection);
    assert.match(JSON.stringify(requests[2]),/查询结果/);
  });
  if(['responses','chat-completions'].includes(protocol))test(`${id} 工具轮缺少实际用量时停止，不执行工具`,async t=>{
    const saved=process.env[key];process.env[key]='usage-secret';
    t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
    const connection=await getModelConnection(id);
    for(const usage of [undefined,protocol==='responses'?{input_tokens:20}:{prompt_tokens:20}]) {
      let calls=0,requests=0;
      await assert.rejects(runConfiguredChat({...base,model:id,maxToolPasses:2,tools:[lookupTool],executeTool:async()=>{calls++;return '查询结果';},fetchImpl:async()=>{requests++;return toolReply(protocol,usage);}},connection),/token 用量不完整/);
      assert.equal(calls,0);
      assert.equal(requests,1);
    }
  });
}

test('Gemini 图片、音频、视频和录音转文字输入使用原生内容格式',async t=>{
  const key='MICU_GOOGLE_API_KEY';const saved=process.env[key];process.env[key]='media-secret';
  t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
  const connection=await getModelConnection('google/gemini-3.8-flash');
  let body;
  await runConfiguredChat({...base,model:connection.model.id,messages:[{role:'user',content:[
    {type:'text',text:'描述图片和视频，并转写录音'},
    {type:'image_url',image_url:{url:'data:image/png;base64,aW1hZ2U='}},
    {type:'input_audio',input_audio:{format:'wav',data:'YXVkaW8='}},
    {type:'inline_media',inlineData:{mimeType:'video/mp4',data:'dmlkZW8='}},
  ]}],fetchImpl:async(url,init)=>{body=JSON.parse(init.body);return completed('gemini');}},connection);
  assert.deepEqual(body.contents[0].parts,[{text:'描述图片和视频，并转写录音'},{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}},{inlineData:{mimeType:'audio/wav',data:'YXVkaW8='}},{inlineData:{mimeType:'video/mp4',data:'dmlkZW8='}}]);
});

test('Gemini 从私有文件读取音视频并使用原生 inlineData',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'micu-media-'));
  const savedRoot=process.env.STORAGE_ROOT;
  const key='MICU_GOOGLE_API_KEY',savedKey=process.env[key];
  process.env.STORAGE_ROOT=root;process.env[key]='stored-media-secret';
  t.after(async()=>{if(savedRoot===undefined)delete process.env.STORAGE_ROOT;else process.env.STORAGE_ROOT=savedRoot;if(savedKey===undefined)delete process.env[key];else process.env[key]=savedKey;await rm(root,{recursive:true,force:true});});
  await mkdir(path.join(root,'files'));
  await writeFile(path.join(root,'files','audio'),'audio');
  await writeFile(path.join(root,'files','video'),'video');
  const connection=await getModelConnection('google/gemini-3.8-flash');
  let body;
  await runConfiguredChat({...base,model:connection.model.id,messages:[{role:'user',content:[
    {type:'private_media',media:{category:'audio',file:{storageKey:'audio',mimeType:'audio/wav',extension:'wav'}}},
    {type:'private_media',media:{category:'video',file:{storageKey:'video',mimeType:'video/mp4',extension:'mp4'}}},
  ]}],fetchImpl:async(url,init)=>{body=JSON.parse(init.body);return completed('gemini');}},connection);
  assert.deepEqual(body.contents[0].parts,[{inlineData:{mimeType:'audio/wav',data:'YXVkaW8='}},{inlineData:{mimeType:'video/mp4',data:'dmlkZW8='}}]);
});
