import OpenAI from "openai";
import { resolveVectaixCodexConfig } from "@/lib/modelRoutes";
import { WEB_BROWSING_MAX_ROUNDS } from "@/lib/server/webBrowsing/types";

function gptServiceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildResponseContent(content, role) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw gptServiceError("GPT 对话内容格式无效", 400);
  }
  if (role === "assistant") {
    return content.map((part) => {
      if (typeof part?.text !== "string") {
        throw gptServiceError("GPT 历史回复格式无效", 400);
      }
      return part.text;
    }).join("");
  }
  return content.map((part) => {
    if (part?.type === "text" && typeof part.text === "string") {
      return { type: "input_text", text: part.text };
    }
    if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
      return { type: "input_image", image_url: part.image_url.url };
    }
    throw gptServiceError("GPT 仅支持文字和图片输入", 400);
  });
}

function buildResponseInput(messages, model) {
  const input = [];
  for (const message of messages) {
    const role = message.role;
    if (role !== "user" && role !== "assistant") {
      throw gptServiceError("GPT 对话消息类型无效", 400);
    }
    const state = message.providerState?.responses;
    if (role === "assistant" && state?.model === model) {
      if (!Array.isArray(state.items) || state.items.length === 0) {
        throw gptServiceError("GPT 对话上下文无效", 400);
      }
      input.push(...state.items);
    } else {
      input.push({ role, content: buildResponseContent(message.content, role) });
    }
  }
  return input;
}

function responseTools(tools) {
  return tools.map((tool) => ({ type: "function", ...tool, strict: true }));
}

async function streamResponse({
  client,
  request,
  signal,
  onText,
  onThought,
  onUpstreamRequest,
  onUpstreamId,
  onUsageRecord,
}) {
  onUpstreamRequest?.();
  const stream = await client.responses.create(request, { signal });
  const itemsByIndex = new Map();
  let completed = false;
  let text = "";
  let thought = "";
  let usage = null;
  let responseId = null;
  let requestId = null;
  let usageRecord = null;
  if (typeof stream?._request_id === "string" && stream._request_id) {
    requestId = stream._request_id;
    onUpstreamId?.(requestId);
  }

  for await (const event of stream) {
    if (typeof event.response?.id === "string" && event.response.id && responseId !== event.response.id) {
      responseId = event.response.id;
      onUpstreamId?.(responseId);
    }
    if (
      typeof event.response?._request_id === "string"
      && event.response._request_id
      && requestId !== event.response._request_id
    ) {
      requestId = event.response._request_id;
      onUpstreamId?.(requestId);
    }
    if (event.response?.usage && !usageRecord) {
      usage = event.response.usage;
      usageRecord = {
        usage,
        ...(responseId ? { responseId } : {}),
        ...(requestId ? { requestId } : {}),
      };
      onUsageRecord?.(usageRecord);
    }
    signal?.throwIfAborted();
    switch (event.type) {
      case "response.output_text.delta":
      case "response.refusal.delta":
        text += event.delta;
        onText(event.delta);
        break;
      case "response.reasoning_summary_text.delta":
        thought += event.delta;
        onThought(event.delta);
        break;
      case "response.output_item.done":
        if (!Number.isInteger(event.output_index) || event.output_index < 0 || !event.item?.type) {
          throw gptServiceError("GPT 返回的回复内容格式无效");
        }
        itemsByIndex.set(event.output_index, event.item);
        break;
      case "response.completed":
        if (event.response?.status !== "completed") {
          throw gptServiceError("GPT 未能完成这次回复");
        }
        completed = true;
        break;
      case "response.failed":
      case "error":
        throw gptServiceError("GPT 回复失败，请稍后再试");
      case "response.incomplete":
        throw gptServiceError("GPT 回复未完成，请缩短问题或对话后再试");
      default:
        break;
    }
  }

  signal?.throwIfAborted();
  if (!completed) throw gptServiceError("GPT 连接中断，回复未完成");
  const indexedItems = Array.from(itemsByIndex.entries()).sort(([left], [right]) => left - right);
  if (indexedItems.length === 0 || indexedItems.some(([index], position) => index !== position)) {
    throw gptServiceError("GPT 返回的对话上下文不完整");
  }
  return {
    text,
    thought,
    usage,
    usageRecord,
    responseId,
    requestId,
    items: indexedItems.map(([, item]) => item),
  };
}

async function runResponses({
  model,
  messages,
  system,
  cacheKey,
  tools,
  getTools,
  executeTool,
  signal,
  onText,
  onThought,
  onUpstreamRequest,
  onUpstreamId,
  onUsageRecord,
  resolveMaxOutputTokens,
}) {
  signal?.throwIfAborted();
  const config = resolveVectaixCodexConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.openAIBaseUrl,
    maxRetries: 0,
  });
  const input = buildResponseInput(messages, model);
  const nativeItems = [];
  const hasTools = Boolean(tools?.length);
  const maxPasses = hasTools ? WEB_BROWSING_MAX_ROUNDS * 2 + 1 : 1;
  let thought = "";
  let usage = null;
  const usageRecords = [];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    signal?.throwIfAborted();
    const activeTools = hasTools ? getTools() : [];
    const requestTools = activeTools.length ? responseTools(activeTools) : [];
    const buildRequest = (outputLimit) => ({
      model,
      instructions: system,
      input,
      stream: true,
      store: false,
      service_tier: "priority",
      reasoning: { effort: "max", summary: "auto" },
      text: { verbosity: "high" },
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: cacheKey,
      ...(Number.isSafeInteger(outputLimit) && outputLimit > 0
        ? { max_output_tokens: outputLimit }
        : {}),
      ...(requestTools.length ? {
        tools: requestTools,
        tool_choice: "auto",
        parallel_tool_calls: false,
      } : {}),
    });
    let passMaxOutputTokens = null;
    if (typeof resolveMaxOutputTokens === "function") {
      const initialLimit = await resolveMaxOutputTokens({ pass, inputPayload: buildRequest(null) });
      if (Number.isSafeInteger(initialLimit) && initialLimit > 0) {
        const verifiedLimit = await resolveMaxOutputTokens({ pass, inputPayload: buildRequest(initialLimit) });
        passMaxOutputTokens = Number.isSafeInteger(verifiedLimit) && verifiedLimit > 0
          ? Math.min(initialLimit, verifiedLimit)
          : initialLimit;
      }
    }
    const completion = await streamResponse({
      client,
      request: buildRequest(passMaxOutputTokens),
      signal,
      onText: hasTools ? () => {} : onText,
      onThought,
      onUpstreamRequest,
      onUpstreamId,
      onUsageRecord,
    });
    thought += completion.thought;
    if (completion.usageRecord) {
      usage = completion.usage;
      usageRecords.push(completion.usageRecord);
    }
    nativeItems.push(...completion.items);
    const calls = completion.items.filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      if (!completion.text.trim()) {
        throw gptServiceError("GPT 没有返回可显示的回复");
      }
      if (hasTools) onText(completion.text);
      return {
        text: completion.text,
        thought,
        usage,
        usageRecords,
        providerState: { responses: { model, items: nativeItems } },
      };
    }

    if (calls.length !== 1 || calls.some((call) => (
      typeof call.call_id !== "string" || !call.call_id
      || typeof call.arguments !== "string"
      || !activeTools.some((tool) => tool.name === call.name)
    ))) {
      throw gptServiceError("GPT 返回了无效的联网工具调用");
    }
    if (pass === maxPasses - 1) {
      throw gptServiceError("联网搜索轮次已用完，GPT 未返回最终回答");
    }
    input.push(...completion.items);
    const call = calls[0];
    signal?.throwIfAborted();
    const output = await executeTool({ id: call.call_id, name: call.name, arguments: call.arguments });
    signal?.throwIfAborted();
    const toolResult = { type: "function_call_output", call_id: call.call_id, output };
    nativeItems.push(toolResult);
    input.push(toolResult);
  }

  throw gptServiceError("联网搜索轮次已用完，GPT 未返回最终回答");
}

export async function runGptResponses(options) {
  try {
    return await runResponses(options);
  } catch (error) {
    if (options.signal?.aborted || !(error instanceof OpenAI.APIError)) throw error;
    if (error.status === 401 || error.status === 403) {
      throw gptServiceError("GPT 模型服务认证失败，请联系管理员", 500);
    }
    if (error.status === 429) {
      throw gptServiceError("GPT 请求过于频繁，请稍后再试", 429);
    }
    if (error.status === 400) {
      throw gptServiceError("GPT 无法处理这次请求，请检查输入内容或对话长度", 400);
    }
    throw gptServiceError("暂时无法连接 GPT 模型服务，请稍后再试");
  }
}
