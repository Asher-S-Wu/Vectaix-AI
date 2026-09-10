import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
process.env.MONGO_URI='mongodb://127.0.0.1:27017/unused-model-tests';
const {runOpenAICompatibleChat}=await import('../../lib/server/providers/directChat.js');
const {runGptResponses}=await import('../../lib/server/providers/gptResponses.js');
const base={model:'local',messages:[{role:'user',content:'你好'}],system:'中文',onText(){},onThought(){}};
test('Chat Completions 使用自定义上游名称、输出上限并返回真实用量',async()=>{
  let request;
  const client=new OpenAI({apiKey:'fixture',baseURL:'https://fixture.invalid/v1',maxRetries:0,fetch:async(url,init)=>{
    request={url:String(url),body:JSON.parse(init.body)};
    const chunks=[{id:'r1',choices:[{index:0,delta:{content:'完成'},finish_reason:null}]},{id:'r1',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2}}];
    return new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
  const result=await runOpenAICompatibleChat({...base,client,requestModel:'my-upstream',requestExtras:{max_completion_tokens:256,stream_options:{include_usage:true}},persistNativeMessages:true});
  assert.equal(request.body.model,'my-upstream');
  assert.equal(request.body.max_completion_tokens,256);
  assert.equal(result.text,'完成');
  assert.equal(result.usageRecords[0].usage.prompt_tokens,10);
  assert.equal(result.providerState.chatCompletions.model,'local');
});
test('Responses 使用动态配置并保留可继续对话的原生条目',async()=>{
  let request;
  const client=new OpenAI({apiKey:'fixture',baseURL:'https://fixture.invalid/v1',maxRetries:0,fetch:async(url,init)=>{
    request={url:String(url),body:JSON.parse(init.body)};
    const item={id:'m1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'完成',annotations:[]}]};
    return new Response([{type:'response.output_text.delta',delta:'完成'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'r2',status:'completed',usage:{input_tokens:8,output_tokens:2}}}].map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  }});
  const result=await runGptResponses({...base,client,provider:{},modelConfig:{upstreamModel:'custom-response',maxOutputTokens:512,requestOptions:{}}});
  assert.equal(request.body.model,'custom-response');
  assert.equal(request.body.max_output_tokens,512);
  assert.equal(result.text,'完成');
  assert.equal(result.providerState.responses.items[0].id,'m1');
});
