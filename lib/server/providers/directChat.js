import OpenAI from 'openai';
import { getModelConnection } from '@/lib/server/models/service';

function chatError(message, status = 502) {
  return Object.assign(new Error(message), { status, publicMessage: true });
}

function messageContent(content, role) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw chatError('对话内容格式无效', 400);
  if (role === 'assistant') {
    if (content.some(part => typeof part?.text !== 'string')) throw chatError('历史回复格式无效', 400);
    return content.map(part => part.text).join('');
  }
  return content.map(part => {
    if (part?.type === 'text' && typeof part.text === 'string') return { type: 'input_text', text: part.text };
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') return { type: 'input_image', image_url: part.image_url.url, detail: 'original' };
    throw chatError('请使用文字或图片继续对话', 400);
  });
}

function buildInput(messages, model, providerId) {
  const input = [];
  for (const message of messages) {
    if (!['user', 'assistant'].includes(message.role)) throw chatError('对话消息类型无效', 400);
    const state = message.providerState?.responses;
    if (message.role === 'assistant' && state?.model === model && state.providerId === providerId) {
      if (!Array.isArray(state.items) || !state.items.length) throw chatError('对话上下文无效', 400);
      input.push(...state.items);
    } else {
      input.push({ role: message.role, content: messageContent(message.content, message.role) });
    }
  }
  return input;
}

function toolOutput(output) {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) throw chatError('工具返回的内容格式无效');
  return output.map(part => {
    if (part?.type === 'input_text' && typeof part.text === 'string') return { type: 'input_text', text: part.text };
    if (part?.type === 'input_image' && typeof part.image_url === 'string') return { type: 'input_image', image_url: part.image_url, detail: 'original' };
    throw chatError('工具返回的内容格式无效');
  });
}

async function streamResponse({ client, request, signal, onText, onThought, onUpstreamRequest, onUpstreamId, onUsageRecord }) {
  signal?.throwIfAborted();
  await onUpstreamRequest?.();
  const stream = await client.responses.create(request, { signal });
  let text = '', thought = '', completed = false, usageRecord = null, items = null;
  let responseId, requestId, created;
  if (stream._request_id) {
    requestId = stream._request_id;
    onUpstreamId?.(requestId);
  }
  for await (const event of stream) {
    signal?.throwIfAborted();
    if (event.response?.id && event.response.id !== responseId) {
      responseId = event.response.id;
      onUpstreamId?.(responseId);
    }
    if (Number.isSafeInteger(event.response?.created_at) && event.response.created_at > 0) created = event.response.created_at;
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type) && event.response?.usage) {
      const usage = event.response.usage;
      if (![usage.input_tokens, usage.output_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw chatError('对话服务返回的 token 用量不完整');
      }
      usageRecord = { usage, responseId, ...(requestId ? { requestId } : {}), ...(created ? { created } : {}) };
      onUsageRecord?.(usageRecord);
    }
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        text += event.delta;
        onText(event.delta);
        break;
      case 'response.reasoning_text.delta':
        thought += event.delta;
        onThought(event.delta);
        break;
      case 'response.completed':
        if (event.response?.status !== 'completed') throw chatError('助手尚未完成这次回复');
        completed = true;
        items = event.response.output;
        break;
      case 'response.incomplete':
        throw chatError('回复达到长度上限，请缩短问题后再试');
      case 'response.failed':
      case 'error':
        throw chatError('对话服务回复失败，请稍后再试');
      default:
        break;
    }
  }
  signal?.throwIfAborted();
  if (!completed) throw chatError('对话连接中断，回复尚未完成');
  if (!usageRecord) throw chatError('对话服务返回的 token 用量不完整');
  if (!Array.isArray(items) || !items.length || items.some(item => !['message', 'reasoning', 'function_call'].includes(item?.type))) {
    throw chatError('对话服务返回的上下文格式无效');
  }
  return { text, thought, items, usage: usageRecord.usage, usageRecord };
}

async function runResponses(options, { model, provider }) {
  const { messages, system, tools = [], getTools, executeTool, signal, onText, onThought, onPassComplete, prepareMessages, resolveMaxOutputTokens } = options;
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl, maxRetries: 0, ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}) });
  let input = buildInput(messages, model.id, provider.id);
  const nativeItems = [], usageRecords = [];
  let thought = '';
  const hasTools = tools.length > 0;
  const maxPasses = hasTools ? (options.maxToolPasses ?? 11) : 1;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    signal?.throwIfAborted();
    if (prepareMessages) {
      const priorItems = new Set(input);
      input = await prepareMessages(input);
      nativeItems.push(...input.filter(item => !priorItems.has(item)));
    }
    const activeTools = hasTools ? (getTools ? getTools() : tools) : [];
    const buildRequest = maxTokens => ({
      model: model.upstreamModel,
      ...model.requestOptions,
      instructions: system,
      input,
      stream: true,
      max_output_tokens: maxTokens,
      ...(activeTools.length ? { tools: activeTools.map(tool => ({ type: 'function', ...tool })), tool_choice: 'auto' } : {}),
    });
    let outputLimit = model.defaultOutputTokens;
    if (resolveMaxOutputTokens) {
      const limit = await resolveMaxOutputTokens({ pass, inputPayload: buildRequest(outputLimit) });
      if (!Number.isSafeInteger(limit) || limit < 1) throw chatError('回复长度设置无效', 400);
      outputLimit = Math.min(outputLimit, limit);
    }
    const completion = await streamResponse({
      ...options,
      client,
      request: buildRequest(outputLimit),
      onText: hasTools && !options.streamToolText ? () => {} : onText,
      onThought,
    });
    await onPassComplete?.({ pass, completion });
    usageRecords.push(completion.usageRecord);
    thought += completion.thought;
    nativeItems.push(...completion.items);
    const calls = completion.items.filter(item => item.type === 'function_call');
    if (!calls.length) {
      if (!completion.text.trim()) throw chatError('助手尚未生成可显示的回复，请重新发送');
      if (hasTools && !options.streamToolText) onText(completion.text);
      return {
        text: completion.text,
        thought,
        usage: completion.usage,
        usageRecords,
        providerState: { responses: { model: model.id, providerId: provider.id, items: nativeItems } },
      };
    }
    const callIds = new Set();
    if (calls.some(call => {
      const invalid = typeof call.call_id !== 'string' || !call.call_id || callIds.has(call.call_id)
        || typeof call.arguments !== 'string' || !activeTools.some(tool => tool.name === call.name);
      callIds.add(call.call_id);
      return invalid;
    })) throw chatError('助手返回了未授权或无效的工具调用');
    if (pass === maxPasses - 1) throw chatError('工具调用轮次已用完，请继续对话完成任务');
    const results = [];
    for (const call of calls) {
      signal?.throwIfAborted();
      const output = await executeTool({ id: call.call_id, name: call.name, arguments: call.arguments });
      signal?.throwIfAborted();
      results.push({ type: 'function_call_output', call_id: call.call_id, output: toolOutput(output) });
    }
    nativeItems.push(...results);
    input.push(...completion.items, ...results);
  }
  throw chatError('助手尚未完成这次回复');
}

export async function runDirectChat(options) {
  try {
    return await runResponses(options, await getModelConnection());
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export function normalizeProviderError(error) {
  if (!(error instanceof OpenAI.APIError)) return error;
  if (error.status === 401 || error.status === 403) return chatError('对话服务认证失败，请联系管理员', 503);
  if (error.status === 429) return chatError('对话请求过于频繁，请稍后再试', 429);
  if (error.status === 400) return chatError('请检查输入内容和对话长度后重试', 400);
  return chatError('暂时无法连接对话服务，请稍后再试');
}
