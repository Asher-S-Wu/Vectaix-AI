function failure(message,status=502) { return Object.assign(new Error(message),{status}); }
async function* sse(response) {
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  try {
    for (;;) {
      const {done,value}=await reader.read();
      buffer=(buffer+decoder.decode(value,{stream:!done})).replace(/\r\n/g,'\n');
      let boundary;
      while ((boundary=buffer.indexOf('\n\n'))>=0) {
        const block=buffer.slice(0,boundary); buffer=buffer.slice(boundary+2);
        const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if (data && data!=='[DONE]') yield JSON.parse(data);
      }
      if (buffer.length>4_000_000) throw failure('模型单条消息过大');
      if (done) break;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
function imageSource(url,protocol) {
  const match=/^data:([^;]+);base64,(.+)$/s.exec(url);
  if (protocol==='anthropic') return match?{type:'image',source:{type:'base64',media_type:match[1],data:match[2]}}:{type:'image',source:{type:'url',url}};
  if (!match) throw failure('此接口的图片需要上传后发送',400);
  return {inlineData:{mimeType:match[1],data:match[2]}};
}
function contentParts(content,protocol) {
  if (typeof content==='string') return protocol==='anthropic'?[{type:'text',text:content}]:[{text:content}];
  return content.map(part=>{
    if (typeof part.text==='string') return protocol==='anthropic'?{type:'text',text:part.text}:{text:part.text};
    if (part.type==='image_url') return imageSource(typeof part.image_url==='string'?part.image_url:part.image_url.url,protocol);
    if (part.type==='inline_media' && protocol==='gemini') return {inlineData:part.inlineData};
    if (part.type==='input_audio' && protocol==='gemini') return {inlineData:{mimeType:`audio/${part.input_audio.format}`,data:part.input_audio.data}};
    throw failure('模型不支持此输入内容',400);
  });
}
function nativeMessages(messages,model,protocol) {
  const result=[];
  for (const message of messages) {
    const state=message.providerState?.[protocol];
    if (message.role==='assistant' && state?.model===model && Array.isArray(state.messages)) result.push(...state.messages);
    else if (protocol==='anthropic') result.push({role:message.role,content:contentParts(message.content,protocol)});
    else result.push({role:message.role==='assistant'?'model':'user',parts:contentParts(message.content,protocol)});
  }
  return result;
}
async function streamAnthropic(response,options) {
  const blocks=[]; const jsonParts=new Map();
  let usage={},responseId,text='',thought='',stopped=false,reason;
  for await (const event of sse(response)) {
    options.signal?.throwIfAborted();
    if (event.type==='error') throw failure('模型服务返回错误');
    if (event.type==='message_start') { responseId=event.message.id; usage={...event.message.usage}; options.onUpstreamId?.(responseId); }
    if (event.type==='content_block_start') blocks[event.index]={...event.content_block};
    if (event.type==='content_block_delta') {
      const block=blocks[event.index]; if (!block) throw failure('模型消息顺序无效');
      const delta=event.delta;
      if (delta.type==='text_delta') { block.text+=delta.text;text+=delta.text;options.onText(delta.text); }
      if (delta.type==='thinking_delta') { block.thinking+=delta.thinking;thought+=delta.thinking;options.onThought(delta.thinking); }
      if (delta.type==='signature_delta') block.signature=(block.signature||'')+delta.signature;
      if (delta.type==='input_json_delta') jsonParts.set(event.index,(jsonParts.get(event.index)||'')+delta.partial_json);
    }
    if (event.type==='message_delta') { usage={...usage,...event.usage};reason=event.delta.stop_reason; }
    if (event.type==='message_stop') stopped=true;
  }
  for (const [index,json] of jsonParts) blocks[index].input=JSON.parse(json);
  const input=usage.input_tokens;
  const output=usage.output_tokens;
  const cached=usage.cache_read_input_tokens||0; const write=usage.cache_creation_input_tokens||0;
  const normalized={input_tokens:input+cached+write,output_tokens:output,input_tokens_details:{cached_tokens:cached},cache_write_tokens:write};
  const usageRecord=Number.isSafeInteger(input)&&Number.isSafeInteger(output)?{usage:normalized,responseId}:null;
  if (usageRecord) options.onUsageRecord?.(usageRecord);
  if (!stopped || !['end_turn','tool_use','stop_sequence'].includes(reason)) throw failure('模型回复未完整结束');
  return {text,thought,usage:normalized,usageRecord,message:{role:'assistant',content:blocks},calls:blocks.filter(block=>block.type==='tool_use').map(block=>({id:block.id,name:block.name,arguments:JSON.stringify(block.input)}))};
}
async function streamGemini(response,options) {
  const parts=[]; let text='',thought='',usage=null,responseId,finishReason;
  for await (const event of sse(response)) {
    options.signal?.throwIfAborted();
    if (event.error || event.promptFeedback?.blockReason) throw failure('模型无法处理这次请求');
    if (event.responseId) { responseId=event.responseId;options.onUpstreamId?.(responseId); }
    const candidate=event.candidates?.[0];
    if (candidate?.finishReason) finishReason=candidate.finishReason;
    for (const part of candidate?.content?.parts||[]) {
      parts.push(part);
      if (part.text && part.thought) { thought+=part.text;options.onThought(part.text); }
      else if (part.text) { text+=part.text;options.onText(part.text); }
    }
    if (event.usageMetadata) {
      const metadata=event.usageMetadata;
      usage={input_tokens:metadata.promptTokenCount,output_tokens:metadata.candidatesTokenCount+(metadata.thoughtsTokenCount||0),input_tokens_details:{cached_tokens:metadata.cachedContentTokenCount||0}};
    }
  }
  const usageRecord=usage&&Number.isSafeInteger(usage.input_tokens)&&Number.isSafeInteger(usage.output_tokens)?{usage,responseId}:null;
  if (usageRecord) options.onUsageRecord?.(usageRecord);
  if (finishReason!=='STOP') throw failure('模型回复未完整结束');
  return {text,thought,usage,usageRecord,message:{role:'model',parts},calls:parts.filter(part=>part.functionCall).map((part,index)=>({id:part.functionCall.id||`gemini-${index}`,nativeId:part.functionCall.id,name:part.functionCall.name,arguments:JSON.stringify(part.functionCall.args)}))};
}
export async function runNativeChat(options) {
  const {model,modelConfig,provider,system,tools=[],getTools,executeTool,signal,fetchImpl=fetch,onText,onThought}=options;
  const protocol=provider.protocol;
  if (!['anthropic','gemini'].includes(protocol)) throw failure('接口协议无效',400);
  let messages=nativeMessages(options.messages,model,protocol);
  const native=[];const usageRecords=[];let thought='';
  for (let pass=0;pass<(tools.length?(options.maxToolPasses??11):1);pass++) {
    signal?.throwIfAborted();
    if (options.prepareMessages) messages=await options.prepareMessages(messages,{protocol});
    const activeTools=tools.length?(getTools?getTools():tools):[];
    const buildRequest=limit=>protocol==='anthropic'?{
      ...modelConfig.requestOptions,model:modelConfig.upstreamModel,system,messages,max_tokens:limit,stream:true,
      ...(activeTools.length?{tools:activeTools.map(tool=>({name:tool.name,description:tool.description,input_schema:tool.parameters}))}:{}),
    }:{
      contents:messages,...(system?{systemInstruction:{parts:[{text:system}]}}:{}),
      generationConfig:{...modelConfig.requestOptions.generationConfig,maxOutputTokens:limit},
      ...(activeTools.length?{tools:[{functionDeclarations:activeTools.map(tool=>({name:tool.name,description:tool.description,parametersJsonSchema:tool.parameters}))}]}:{}),
    };
    let limit=modelConfig.maxOutputTokens;
    if (options.resolveMaxOutputTokens) limit=Math.min(limit,await options.resolveMaxOutputTokens({pass,inputPayload:buildRequest(limit)}));
    if (!Number.isSafeInteger(limit)||limit<1) throw failure('输出长度无效',400);
    const url=protocol==='anthropic'?`${provider.baseUrl}/messages`:`${provider.baseUrl}/models/${encodeURIComponent(modelConfig.upstreamModel)}:streamGenerateContent?alt=sse`;
    const headers=protocol==='anthropic'?{'x-api-key':provider.apiKey,'anthropic-version':'2023-06-01'}:{'x-goog-api-key':provider.apiKey};
    await options.onUpstreamRequest?.();
    let response;
    try { response=await fetchImpl(url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(buildRequest(limit)),signal,redirect:'error'}); }
    catch(error) { if (signal?.aborted) throw error;throw failure('无法连接模型服务'); }
    if (!response.ok) { await response.body?.cancel();throw failure(`模型服务请求失败（${response.status}）`,response.status); }
    const streamOptions={...options,onText:tools.length&&!options.streamToolText?()=>{}:onText,onThought};
    const completion=await (protocol==='anthropic'?streamAnthropic(response,streamOptions):streamGemini(response,streamOptions));
    await options.onPassComplete?.({pass,completion});
    if (completion.usageRecord) usageRecords.push(completion.usageRecord);
    thought+=completion.thought;
    native.push(completion.message);messages.push(completion.message);
    if (!completion.calls.length) {
      if (tools.length&&!options.streamToolText) onText(completion.text);
      return {text:completion.text,thought,usage:completion.usage,usageRecords,providerState:{[protocol]:{model,messages:native}}};
    }
    if (pass===(options.maxToolPasses??11)-1) throw failure('工具调用轮次已用完');
    const results=[];
    for (const call of completion.calls) {
      if (!activeTools.some(tool=>tool.name===call.name)) throw failure('模型调用了未授权的工具');
      const output=await executeTool({id:call.id,name:call.name,arguments:call.arguments});
      results.push(protocol==='anthropic'?{type:'tool_result',tool_use_id:call.id,content:output}:{functionResponse:{...(call.nativeId?{id:call.nativeId}:{}),name:call.name,response:{result:output}}});
    }
    const result=protocol==='anthropic'?{role:'user',content:results}:{role:'user',parts:results};
    native.push(result);messages.push(result);
  }
  throw failure('模型未完成回复');
}
