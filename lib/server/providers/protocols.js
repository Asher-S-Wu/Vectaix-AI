import OpenAI from 'openai';
import { publicFetch } from '@/lib/server/integrations/network.mjs';

export function providerError(message, status = 502) { return Object.assign(new Error(message), { status, publicMessage: true }); }
const count = value => Number.isSafeInteger(value) && value >= 0;

export function normalizeUsage(usage, protocol) {
  if (!usage || typeof usage !== 'object') throw providerError('对话服务返回的 token 用量不完整');
  let input, output, cached;
  if (protocol === 'chat') {
    input = usage.prompt_tokens; output = usage.completion_tokens; cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  } else if (protocol === 'messages') {
    const cacheRead = usage.cache_read_input_tokens ?? 0, cacheWrite = usage.cache_creation_input_tokens ?? 0;
    if (!count(cacheRead) || !count(cacheWrite) || !count(usage.input_tokens)) throw providerError('对话服务返回的 token 用量不完整');
    input = usage.input_tokens + cacheRead + cacheWrite; output = usage.output_tokens; cached = cacheRead;
  } else {
    input = usage.input_tokens; output = usage.output_tokens; cached = usage.input_tokens_details?.cached_tokens ?? 0;
  }
  if (![input, output, cached].every(count) || cached > input) throw providerError('对话服务返回的 token 用量不完整');
  return { ...usage, input_tokens: input, output_tokens: output, input_tokens_details: { ...usage.input_tokens_details, cached_tokens: cached } };
}

function imageUrl(part) {
  const url = part.type === 'input_image' ? part.image_url : part.image_url?.url;
  if (typeof url !== 'string' || !url) throw providerError('图片内容格式无效', 400);
  return url;
}

function messagePart(part, protocol) {
  if (['text', 'input_text'].includes(part?.type) && typeof part.text === 'string') return { type: 'text', text: part.text };
  if (['image_url', 'input_image'].includes(part?.type)) {
    const url = imageUrl(part);
    if (protocol === 'chat') return { type: 'image_url', image_url: { url } };
    const encoded = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(url);
    return { type: 'image', source: encoded ? { type: 'base64', media_type: encoded[1], data: encoded[2] } : { type: 'url', url } };
  }
  if (protocol === 'messages' && ['text', 'image', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(part?.type)) return part;
  throw providerError('对话内容格式无效', 400);
}

function normalizeMessage(message, protocol) {
  const result = { ...message };
  delete result.providerState;
  if (Array.isArray(result.content)) result.content = result.content.map(part => messagePart(part, protocol));
  return result;
}

function historyInput(messages, model, provider, protocol) {
  return messages.flatMap(message => {
    if (!['user', 'assistant'].includes(message.role)) throw providerError('对话消息类型无效', 400);
    const state = message.providerState?.[protocol];
    if (message.role === 'assistant' && state?.model === model.id && state.providerId === provider.id) return structuredClone(state.items);
    return [normalizeMessage(message, protocol)];
  });
}

function toolResult(output, protocol) {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) throw providerError('工具返回的内容格式无效');
  return output.map(part => messagePart(part, protocol));
}

function checkCalls(calls, activeTools) {
  const ids = new Set();
  for (const call of calls) {
    if (typeof call.id !== 'string' || !call.id || ids.has(call.id) || typeof call.arguments !== 'string' || !activeTools.some(tool => tool.name === call.name)) throw providerError('助手返回了未授权或无效的工具调用');
    try { const args = JSON.parse(call.arguments); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(); }
    catch { throw providerError('助手返回的工具参数格式无效'); }
    ids.add(call.id);
  }
}

async function streamChat({ client, request, signal, onText, onThought, onUpstreamRequest, onUpstreamId, onUsageRecord }) {
  signal?.throwIfAborted();
  await onUpstreamRequest?.();
  const stream = await client.chat.completions.create(request, { signal });
  let text = '', thought = '', finishReason, usageRecord, responseId, created;
  const calls = new Map();
  const requestId = stream._request_id;
  if (requestId) onUpstreamId?.(requestId);
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    if (chunk.id && chunk.id !== responseId) { responseId = chunk.id; onUpstreamId?.(responseId); }
    if (count(chunk.created)) created = chunk.created;
    if (chunk.usage) {
      usageRecord = { usage: normalizeUsage(chunk.usage, 'chat'), responseId, ...(requestId ? { requestId } : {}), ...(created ? { created } : {}) };
      onUsageRecord?.(usageRecord);
    }
    for (const choice of chunk.choices || []) {
      if (choice.index !== 0) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string') { text += delta.content; onText(delta.content); }
      if (typeof delta.reasoning_content === 'string') { thought += delta.reasoning_content; onThought(delta.reasoning_content); }
      if (typeof delta.refusal === 'string') { text += delta.refusal; onText(delta.refusal); }
      for (const part of delta.tool_calls || []) {
        if (!Number.isSafeInteger(part.index) || part.index < 0) throw providerError('工具调用编号无效');
        let call = calls.get(part.index);
        if (!call) { call = { id: '', name: '', arguments: '' }; calls.set(part.index, call); }
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  signal?.throwIfAborted();
  if (!finishReason) throw providerError('对话连接中断，回复尚未完成');
  if (!usageRecord) throw providerError('对话服务返回的 token 用量不完整');
  if (finishReason === 'length') throw providerError('回复达到长度上限，请调整输出长度后再试');
  if (!['stop', 'tool_calls'].includes(finishReason)) throw providerError('对话服务结束了本次生成，请调整问题后重试');
  const toolCalls = [...calls.values()];
  if ((finishReason === 'tool_calls') !== Boolean(toolCalls.length)) throw providerError('对话服务返回的工具调用状态无效');
  const assistant = { role: 'assistant', content: text || null,
    ...(thought ? { reasoning_content: thought } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}),
  };
  return { text, thought, calls: toolCalls, items: [assistant], usage: usageRecord.usage, usageRecord };
}

async function* serverEvents(response, signal) {
  if (!response.body) throw providerError('对话服务未返回内容');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const packet = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = packet.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try { yield JSON.parse(data); } catch (error) { if (error instanceof SyntaxError) throw providerError('对话服务返回了无效的事件'); throw error; }
      }
      if (buffer.length > 8 * 1024 * 1024) throw providerError('模型单次事件过大');
      if (done) break;
    }
    if (buffer.trim()) throw providerError('对话连接中断，事件尚未接收完整');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function streamMessages({ fetchImpl = publicFetch, provider, request, signal, onText, onThought, onUpstreamRequest, onUpstreamId, onUsageRecord }) {
  signal?.throwIfAborted();
  await onUpstreamRequest?.();
  const response = await fetchImpl(`${provider.baseUrl}/messages`, { method: 'POST', signal, redirect: 'error', headers: {
    'content-type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01',
  }, body: JSON.stringify(request) });
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw providerError('对话服务认证失败，请联系管理员', 503);
    if (response.status === 429) throw providerError('对话请求过于频繁，请稍后再试', 429);
    throw providerError('模型请求失败，请管理员检查 Message 协议设置');
  }
  const requestId = response.headers.get('request-id');
  if (requestId) onUpstreamId?.(requestId);
  let responseId, text = '', thought = '', stopReason, completed = false, rawUsage = {}, usageRecord;
  const blocks = new Map(), argumentsByIndex = new Map(), openBlocks = new Set();
  for await (const event of serverEvents(response, signal)) {
    switch (event.type) {
      case 'message_start':
        responseId = event.message?.id;
        onUpstreamId?.(responseId);
        rawUsage = { ...event.message?.usage };
        break;
      case 'content_block_start': {
        if (!Number.isSafeInteger(event.index) || event.index < 0 || blocks.has(event.index) || !['text', 'tool_use', 'thinking', 'redacted_thinking'].includes(event.content_block?.type)) throw providerError('模型回复内容格式无效');
        const block = structuredClone(event.content_block);
        blocks.set(event.index, block); openBlocks.add(event.index);
        if (block.type === 'text' && block.text) { text += block.text; onText(block.text); }
        break;
      }
      case 'content_block_delta': {
        const block = blocks.get(event.index), delta = event.delta;
        if (!block || !openBlocks.has(event.index)) throw providerError('模型回复内容顺序无效');
        if (delta?.type === 'text_delta') { block.text += delta.text; text += delta.text; onText(delta.text); }
        else if (delta?.type === 'thinking_delta') { block.thinking += delta.thinking; thought += delta.thinking; onThought(delta.thinking); }
        else if (delta?.type === 'signature_delta') block.signature = (block.signature || '') + delta.signature;
        else if (delta?.type === 'input_json_delta') argumentsByIndex.set(event.index, (argumentsByIndex.get(event.index) || '') + delta.partial_json);
        break;
      }
      case 'content_block_stop': {
        if (!openBlocks.delete(event.index)) throw providerError('模型回复内容顺序无效');
        if (argumentsByIndex.has(event.index)) {
          try { blocks.get(event.index).input = JSON.parse(argumentsByIndex.get(event.index)); }
          catch { throw providerError('助手返回的工具参数格式无效'); }
        }
        break;
      }
      case 'message_delta':
        stopReason = event.delta?.stop_reason;
        rawUsage = { ...rawUsage, ...event.usage };
        usageRecord = { usage: normalizeUsage(rawUsage, 'messages'), responseId, ...(requestId ? { requestId } : {}) };
        onUsageRecord?.(usageRecord);
        break;
      case 'message_stop': completed = true; break;
      case 'error': throw providerError('模型回复失败，请稍后重试');
      default: break;
    }
  }
  signal?.throwIfAborted();
  if (!completed || openBlocks.size) throw providerError('对话连接中断，回复尚未完成');
  if (!usageRecord) throw providerError('对话服务返回的 token 用量不完整');
  if (stopReason === 'max_tokens') throw providerError('回复达到长度上限，请调整输出长度后再试');
  if (!['end_turn', 'tool_use', 'stop_sequence'].includes(stopReason)) throw providerError('对话服务结束了本次生成，请调整问题后重试');
  const content = [...blocks].sort((a, b) => a[0] - b[0]).map(([, block]) => block);
  const calls = content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) }));
  if ((stopReason === 'tool_use') !== Boolean(calls.length)) throw providerError('对话服务返回的工具调用状态无效');
  return { text, thought, calls, items: [{ role: 'assistant', content }], usage: usageRecord.usage, usageRecord };
}

export async function runMessageProtocol(options, { model, provider }) {
  const protocol = provider.protocol;
  const { system, signal, executeTool, prepareMessages, resolveMaxOutputTokens, onPassComplete } = options;
  const onText = options.onText || (() => {}), onThought = options.onThought || (() => {});
  const client = protocol === 'chat' ? new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl, maxRetries: 0, fetch: options.fetchImpl || publicFetch }) : null;
  let input = historyInput(options.messages, model, provider, protocol), thought = '';
  const nativeItems = [], usageRecords = [];
  const hasTools = model.supportsTools && Boolean(options.tools?.length);
  const maxPasses = hasTools ? (options.maxToolPasses ?? 11) : 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    signal?.throwIfAborted();
    if (prepareMessages) {
      const oldItems = new Set(input);
      const prepared = await prepareMessages(input);
      nativeItems.push(...prepared.filter(item => !oldItems.has(item)).map(item => normalizeMessage(item, protocol)));
      input = prepared.map(item => normalizeMessage(item, protocol));
    }
    const activeTools = hasTools ? (options.getTools ? options.getTools() : options.tools) : [];
    const buildRequest = maxTokens => protocol === 'chat' ? {
      model: model.upstreamModel, ...model.requestOptions,
      messages: [{ role: 'system', content: system }, ...input], stream: true, stream_options: { include_usage: true }, max_completion_tokens: maxTokens,
      ...(activeTools.length ? { tools: activeTools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {}),
    } : {
      model: model.upstreamModel, ...model.requestOptions, system, messages: input, max_tokens: maxTokens, stream: true,
      ...(activeTools.length ? { tools: activeTools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })), tool_choice: { type: 'auto' } } : {}),
    };
    let outputLimit = model.defaultOutputTokens;
    if (resolveMaxOutputTokens) {
      const limit = await resolveMaxOutputTokens({ pass, inputPayload: buildRequest(outputLimit) });
      if (!Number.isSafeInteger(limit) || limit < 1) throw providerError('回复长度设置无效', 400);
      outputLimit = Math.min(outputLimit, limit);
    }
    const completion = await (protocol === 'chat' ? streamChat : streamMessages)({ ...options, client, provider, request: buildRequest(outputLimit), onText: hasTools && !options.streamToolText ? () => {} : onText, onThought });
    await onPassComplete?.({ pass, completion });
    usageRecords.push(completion.usageRecord); thought += completion.thought; nativeItems.push(...completion.items);
    if (!completion.calls.length) {
      if (!completion.text.trim()) throw providerError('助手尚未生成可显示的回复，请重新发送');
      if (hasTools && !options.streamToolText) onText(completion.text);
      return { text: completion.text, thought, usage: completion.usage, usageRecords, providerState: { [protocol]: { model: model.id, providerId: provider.id, items: nativeItems } } };
    }
    checkCalls(completion.calls, activeTools);
    if (pass === maxPasses - 1) throw providerError('工具调用轮次已用完，请继续对话完成任务');
    const results = [], toolImages = [];
    for (const call of completion.calls) {
      signal?.throwIfAborted();
      const output = toolResult(await executeTool(call), protocol);
      signal?.throwIfAborted();
      if (protocol === 'messages') results.push({ type: 'tool_result', tool_use_id: call.id, content: output });
      else {
        const text = typeof output === 'string' ? output : output.filter(part => part.type === 'text').map(part => part.text).join('\n');
        results.push({ role: 'tool', tool_call_id: call.id, content: text });
        if (Array.isArray(output)) for (const part of output) if (part.type === 'image_url') toolImages.push(part);
      }
    }
    const resultMessages = protocol === 'messages' ? [{ role: 'user', content: results }] : [...results, ...(toolImages.length ? [{ role: 'user', content: toolImages }] : [])];
    nativeItems.push(...resultMessages); input.push(...completion.items, ...resultMessages);
  }
  throw providerError('助手尚未完成这次回复');
}
