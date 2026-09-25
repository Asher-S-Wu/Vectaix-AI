import test from 'node:test';
import assert from 'node:assert/strict';
import { runNativeChat } from '../../lib/server/providers/nativeProtocols.mjs';

function stream(events) { return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}}); }
const base={model:'local-id',modelConfig:{upstreamModel:'upstream',maxOutputTokens:4096,requestOptions:{}},messages:[{role:'user',content:'你好'}],system:'中文回答',onText(){},onThought(){}};
test('Anthropic 累积文本、完整缓存用量和签名，并在工具后继续',async()=>{
  const requests=[];
  const thoughts=[];
  const fetchImpl=async(url,init)=>{requests.push({url,body:JSON.parse(init.body),headers:init.headers});return requests.length===1?stream([
    {type:'message_start',message:{id:'a',usage:{input_tokens:10,output_tokens:1,cache_read_input_tokens:3,cache_creation_input_tokens:2}}},
    {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},
    {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'先查询'}},
    {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'signed-'}},
    {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'summary'}},
    {type:'content_block_start',index:1,content_block:{type:'thinking',thinking:'',signature:''}},
    {type:'content_block_delta',index:1,delta:{type:'signature_delta',signature:'signed-empty'}},
    {type:'content_block_start',index:2,content_block:{type:'tool_use',id:'call1',name:'lookup',input:{}}},
    {type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"q":"test"}'}},
    {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:5}}, {type:'message_stop'},
  ]):stream([{type:'message_start',message:{id:'b',usage:{input_tokens:20}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'完成'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},{type:'message_stop'}]);};
  const result=await runNativeChat({...base,onThought:thought=>thoughts.push(thought),provider:{protocol:'anthropic',baseUrl:'https://api.example.com/v1',apiKey:'private'},tools:[{name:'lookup',description:'查找',parameters:{type:'object',properties:{q:{type:'string'}}}}],executeTool:async(call)=>{assert.deepEqual(call,{id:'call1',name:'lookup',arguments:'{"q":"test"}'});return '结果';},fetchImpl});
  assert.equal(result.text,'完成');
  assert.equal(result.thought,'先查询');
  assert.deepEqual(thoughts,['先查询']);
  const assistantContent=[
    {type:'thinking',thinking:'先查询',signature:'signed-summary'},
    {type:'thinking',thinking:'',signature:'signed-empty'},
    {type:'tool_use',id:'call1',name:'lookup',input:{q:'test'}},
  ];
  assert.deepEqual(requests[1].body.messages[1].content,assistantContent);
  assert.deepEqual(result.providerState.anthropic.messages[0].content,assistantContent);
  assert.equal(result.usageRecords[0].usage.input_tokens,15);
  assert.equal(result.usageRecords[0].usage.output_tokens,5);
  assert.equal(result.usageRecords[0].usage.input_tokens_details.cached_tokens,3);
  assert.equal(requests[1].body.messages[2].content[0].tool_use_id,'call1');
  assert.equal(requests[0].url,'https://api.example.com/v1/messages');
});
test('Gemini 保留思考签名及函数调用编号，统计思考输出费用',async()=>{
  const requests=[];
  const fetchImpl=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return requests.length===1?stream([{responseId:'g1',candidates:[{content:{parts:[{functionCall:{id:'c1',name:'lookup',args:{q:'x'}},thoughtSignature:'signed'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,thoughtsTokenCount:7}}]):stream([{responseId:'g2',candidates:[{content:{parts:[{text:'完成'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:2}}]);};
  const result=await runNativeChat({...base,provider:{protocol:'gemini',baseUrl:'https://api.example.com/v1beta',apiKey:'private'},tools:[{name:'lookup',parameters:{type:'object'}}],executeTool:async()=> '结果',fetchImpl});
  assert.equal(result.text,'完成');
  assert.equal(result.usageRecords[0].usage.output_tokens,10);
  assert.equal(requests[1].body.contents[1].parts[0].thoughtSignature,'signed');
  assert.equal(requests[1].body.contents[2].parts[0].functionResponse.id,'c1');
  assert.ok(!requests[0].url.includes('private'));
});
test('接口报错不重试，且不暴露上游密钥或错误原文',async()=>{
  let count=0;
  await assert.rejects(runNativeChat({...base,provider:{protocol:'gemini',baseUrl:'https://api.example.com/v1beta',apiKey:'private'},fetchImpl:async()=>{count++;return new Response('leaked private',{status:401});}}),error=>error.status===401&&!error.message.includes('private'));
  assert.equal(count,1);
});
test('缺少完成标记时拒绝将截断回复当作成功',async()=>{
  await assert.rejects(runNativeChat({...base,provider:{protocol:'anthropic',baseUrl:'https://api.example.com/v1',apiKey:'private'},fetchImpl:async()=>stream([{type:'message_start',message:{id:'a',usage:{input_tokens:10}}}])}),/完整/);
});
test('换行符被拆成独立网络分块时仍能读取完整回复',async()=>{
  const event={candidates:[{content:{parts:[{text:'完成'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:2}};
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\n\r\n`);
  const result=await runNativeChat({...base,provider:{protocol:'gemini',baseUrl:'https://api.example.com/v1beta',apiKey:'private'},fetchImpl:async()=>new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}))});
  assert.equal(result.text,'完成');
  assert.equal(result.usageRecords[0].usage.output_tokens,2);
});

test('原生接口每轮必须返回完整用量，不能漏掉工具轮次的费用',async()=>{
  for(const protocol of ['anthropic','gemini']) {
    const events=protocol==='anthropic'?
      [{type:'message_start',message:{id:'missing',usage:{input_tokens:10}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'call1',name:'lookup',input:{}}},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{}},{type:'message_stop'}]:
      [{candidates:[{content:{parts:[{functionCall:{name:'lookup',args:{}}}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10}}];
    let calls=0;
    await assert.rejects(runNativeChat({...base,provider:{id:`micu-${protocol}`,protocol,baseUrl:'https://fixture.invalid/v1',apiKey:'private'},tools:[{name:'lookup',parameters:{type:'object'}}],executeTool:async()=>{calls++;return '结果';},fetchImpl:async()=>stream(events)}),/用量/);
    assert.equal(calls,0);
  }
});

test('原生接口不能用流开始时的临时用量代替最终用量',async()=>{
  for(const protocol of ['anthropic','gemini']) {
    const events=protocol==='anthropic'?[
      {type:'message_start',message:{id:'partial',usage:{input_tokens:10,output_tokens:1}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'完成'}},
      {type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'},
    ]:[
      {candidates:[{content:{parts:[{text:'完'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:1}},
      {candidates:[{content:{parts:[{text:'成'}]},finishReason:'STOP'}]},
    ];
    const records=[];
    await assert.rejects(runNativeChat({...base,provider:{id:`micu-${protocol}`,protocol,baseUrl:'https://fixture.invalid/v1',apiKey:'private'},onUsageRecord:record=>records.push(record),fetchImpl:async()=>stream(events)}),/用量/);
    assert.equal(records.length,0);
  }
});

test('Gemini 接受 STOP 后单独发送的最终用量',async()=>{
  const result=await runNativeChat({...base,provider:{protocol:'gemini',baseUrl:'https://fixture.invalid/v1beta',apiKey:'private'},fetchImpl:async()=>stream([
    {candidates:[{content:{parts:[{text:'完'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:1}},
    {candidates:[{content:{parts:[{text:'成'}]},finishReason:'STOP'}]},
    {usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,thoughtsTokenCount:3}},
  ])});
  assert.equal(result.text,'完成');
  assert.equal(result.usageRecords.length,1);
  assert.equal(result.usageRecords[0].usage.output_tokens,5);
});
