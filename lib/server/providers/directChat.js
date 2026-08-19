import OpenAI from "openai";
import {
  ABLITERATED_LARGE_MODEL,
  CLAUDE_OPUS_5_MODEL,
  GEMINI_FLASH_MODEL,
  GPT_56_SOL_MODEL,
  GROK_46_MODEL,
  KIMI_K3_MODEL,
  QWEN_38_MAX_MODEL,
} from "@/lib/shared/models";
import {
  resolveAbliterationOpenAIConfig,
  resolveOpenRouterOpenAIConfig,
  resolveQwenChatConfig,
} from "@/lib/modelRoutes";
import { readStoredFileBuffer } from "@/lib/server/storage/service";
import { WebBrowsingApiName } from "@/lib/shared/webBrowsing";

const QWEN_38_MAX_UPSTREAM_MODEL = "qwen3.8-max";
const QWEN_WEB_SEARCH_TOOL_NAME = "webSearch";

function createOpenRouterOpenAI() {
  const config = resolveOpenRouterOpenAIConfig();
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.openAIBaseUrl });
}

function createQwenOpenAI() {
  const config = resolveQwenChatConfig();
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.openAIBaseUrl });
}

function createAbliterationOpenAI() {
  const config = resolveAbliterationOpenAIConfig();
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.openAIBaseUrl,
    maxRetries: 0,
  });
}

function createAbliterationServiceError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.isAbliterationServiceError = true;
  return error;
}

function normalizeAbliterationError(error) {
  if (error?.isAbliterationServiceError === true) return error;
  if (error?.message?.includes("ABLIT_KEY")) {
    return createAbliterationServiceError(
      "Abliteration 模型服务尚未配置，请在 Zeabur 环境变量中设置 ABLIT_KEY",
      500,
      "ABLITERATION_NOT_CONFIGURED"
    );
  }

  const status = Number(error?.status);
  if (status === 400) {
    return createAbliterationServiceError(
      "Abliteration 模型请求无效，请检查输入内容或对话长度",
      400,
      "ABLITERATION_INVALID_REQUEST"
    );
  }
  if (status === 401 || status === 403) {
    return createAbliterationServiceError(
      "Abliteration 模型服务认证失败，请联系管理员",
      500,
      "ABLITERATION_AUTH_FAILED"
    );
  }
  if (status === 402) {
    return createAbliterationServiceError(
      "Abliteration 模型服务余额不足，请联系管理员",
      502,
      "ABLITERATION_BALANCE_INSUFFICIENT"
    );
  }
  if (status === 429) {
    return createAbliterationServiceError(
      "Abliteration 模型服务请求过于频繁，请稍后再试",
      429,
      "ABLITERATION_RATE_LIMITED"
    );
  }
  if (status >= 500) {
    return createAbliterationServiceError(
      "Abliteration 模型服务暂时不可用，请稍后再试",
      502,
      "ABLITERATION_UPSTREAM_FAILED"
    );
  }
  if (error instanceof OpenAI.APIError) {
    return createAbliterationServiceError(
      "暂时无法连接 Abliteration 模型服务，请稍后再试",
      502,
      "ABLITERATION_CONNECTION_FAILED"
    );
  }
  return error;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
}

function imageUrl(part) {
  return typeof part?.image_url === "string" ? part.image_url : part?.image_url?.url;
}

async function toOpenAICompatibleContent(content, role, { textOnly = false } = {}) {
  if (!Array.isArray(content)) return String(content || "");
  const result = [];
  for (const part of content) {
    const url = imageUrl(part);
    const privateMedia = part?.type === "private_media" ? part.media : null;
    if (textOnly && (url || privateMedia || typeof part?.text !== "string")) {
      throw createAbliterationServiceError(
        "Abliterated Model Large 仅支持纯文本输入",
        400,
        "ABLITERATION_UNSUPPORTED_INPUT"
      );
    }
    if (typeof part?.text === "string") {
      result.push({ type: "text", text: part.text });
      continue;
    }
    if (url && role === "user") {
      result.push({ type: "image_url", image_url: { url } });
      continue;
    }
    if (privateMedia?.file && role === "user") {
      const buffer = await readStoredFileBuffer(privateMedia.file);
      if (privateMedia.category === "audio") {
        result.push({
          type: "input_audio",
          input_audio: { data: buffer.toString("base64"), format: privateMedia.file.extension },
        });
      } else if (privateMedia.category === "video") {
        result.push({
          type: "video_url",
          video_url: { url: `data:${privateMedia.file.mimeType};base64,${buffer.toString("base64")}` },
        });
      }
    }
  }
  return result;
}

function storedChatCompletionMessages(message, model) {
  const state = message?.providerState?.chatCompletions;
  if (state?.model !== model || !Array.isArray(state.messages)) return null;
  return state.messages.filter((item) => item && typeof item === "object");
}

async function buildOpenAICompatibleMessages(messages, system, model, options) {
  const result = system ? [{ role: "system", content: system }] : [];
  for (const message of messages || []) {
    if (message?.role === "assistant") {
      const storedMessages = storedChatCompletionMessages(message, model);
      if (storedMessages?.length) {
        result.push(...storedMessages);
        continue;
      }
    }
    const role = message?.role === "assistant" ? "assistant" : "user";
    result.push({
      role,
      content: await toOpenAICompatibleContent(message?.content, role, options),
    });
  }
  return result;
}

function openAIChatTools(tools, mapToolName, strictTools) {
  return (tools || []).map((tool) => ({
    type: "function",
    function: {
      ...tool,
      name: mapToolName(tool.name),
      ...(strictTools ? { strict: true } : {}),
    },
  }));
}

function mergeReasoningDetail(current, fragment) {
  const merged = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
  const appendFields = new Set(["text", "summary", "data"]);
  for (const [key, value] of Object.entries(fragment || {})) {
    if (value === undefined || value === null) continue;
    if (appendFields.has(key) && typeof value === "string") {
      merged[key] = `${typeof merged[key] === "string" ? merged[key] : ""}${value}`;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeOpenAIReasoningDetails(current, fragment) {
  const merged = Array.isArray(current) ? current.slice() : [];
  const fragments = Array.isArray(fragment) ? fragment : (fragment ? [fragment] : []);
  for (const item of fragments) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    let targetIndex = -1;
    if (Number.isInteger(item.index) && merged[item.index]) {
      targetIndex = item.index;
    } else if (typeof item.id === "string" && item.id) {
      targetIndex = merged.findIndex((existing) => existing?.id === item.id);
    } else if (merged.length > 0) {
      const last = merged[merged.length - 1];
      if (last?.type === item.type && last?.format === item.format) targetIndex = merged.length - 1;
    }
    if (targetIndex >= 0) {
      merged[targetIndex] = mergeReasoningDetail(merged[targetIndex], item);
    } else {
      merged.push(mergeReasoningDetail(null, item));
    }
  }
  return merged;
}

function reasoningDetailsText(details) {
  return (Array.isArray(details) ? details : [])
    .map((item) => typeof item?.text === "string" ? item.text : (typeof item?.summary === "string" ? item.summary : ""))
    .join("");
}

function mergeOpenAIToolCalls(toolCallsByIndex, fragments) {
  for (const fragment of fragments || []) {
    const index = Number.isInteger(fragment?.index) ? fragment.index : 0;
    const current = toolCallsByIndex.get(index) || { type: "function", function: { arguments: "" } };
    if (typeof fragment?.id === "string") current.id = fragment.id;
    if (typeof fragment?.type === "string") current.type = fragment.type;
    if (fragment?.function && typeof fragment.function === "object") {
      if (typeof fragment.function.name === "string") {
        current.function.name = `${current.function.name || ""}${fragment.function.name}`;
      }
      if (typeof fragment.function.arguments === "string") {
        current.function.arguments += fragment.function.arguments;
      }
    }
    toolCallsByIndex.set(index, current);
  }
}

async function streamOpenAIChatCompletion({ client, request, signal, onText, onThought }) {
  const stream = await client.chat.completions.create(request, { signal });
  const toolCallsByIndex = new Map();
  let text = "";
  let thought = "";
  let reasoning = "";
  let reasoningContent = "";
  let reasoningDetails = [];
  let usage = null;

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices || []) {
      const delta = choice?.delta || {};
      const content = contentText(delta.content);
      if (content) {
        text += content;
        onText(content);
      }

      const detailFragments = Array.isArray(delta.reasoning_details)
        ? delta.reasoning_details
        : (delta.reasoning_details ? [delta.reasoning_details] : []);
      reasoningDetails = mergeOpenAIReasoningDetails(reasoningDetails, detailFragments);

      let thoughtDelta = "";
      if (typeof delta.reasoning === "string" && delta.reasoning) {
        reasoning += delta.reasoning;
        thoughtDelta = delta.reasoning;
      } else if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        reasoningContent += delta.reasoning_content;
        thoughtDelta = delta.reasoning_content;
      } else {
        thoughtDelta = reasoningDetailsText(detailFragments);
      }
      if (thoughtDelta) {
        thought += thoughtDelta;
        onThought(thoughtDelta);
      }

      mergeOpenAIToolCalls(toolCallsByIndex, delta.tool_calls);
    }
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call);
  return {
    text,
    thought,
    reasoning,
    reasoningContent,
    reasoningDetails,
    toolCalls,
    usage,
  };
}

function toQwenToolName(name) {
  return name === WebBrowsingApiName.search ? QWEN_WEB_SEARCH_TOOL_NAME : name;
}

function fromQwenToolName(name) {
  return name === QWEN_WEB_SEARCH_TOOL_NAME ? WebBrowsingApiName.search : name;
}

function buildChatCompletionProfile(model) {
  if (model === ABLITERATED_LARGE_MODEL) {
    return {
      client: createAbliterationOpenAI(),
      requestModel: model,
      requestExtras: { max_completion_tokens: 131072 },
      textOnly: true,
      persistNativeMessages: false,
      strictTools: false,
    };
  }

  if (model === QWEN_38_MAX_MODEL) {
    return {
      client: createQwenOpenAI(),
      requestModel: QWEN_38_MAX_UPSTREAM_MODEL,
      requestExtras: {
        enable_thinking: true,
        preserve_thinking: false,
        stream_options: { include_usage: true },
      },
      mapToolName: toQwenToolName,
      restoreToolName: fromQwenToolName,
      persistNativeMessages: false,
      strictTools: false,
    };
  }

  const requestExtrasByModel = {
    [GPT_56_SOL_MODEL]: {
      reasoning: { effort: "max" },
      max_completion_tokens: 128000,
      verbosity: "high",
      stream_options: { include_usage: true },
    },
    [CLAUDE_OPUS_5_MODEL]: {
      reasoning: { effort: "max" },
      max_completion_tokens: 128000,
      cache_control: { type: "ephemeral" },
      stream_options: { include_usage: true },
    },
    [GEMINI_FLASH_MODEL]: {
      reasoning: { effort: "high" },
      max_completion_tokens: 65536,
      stream_options: { include_usage: true },
    },
    [GROK_46_MODEL]: {
      reasoning: { effort: "high" },
      stream_options: { include_usage: true },
    },
    [KIMI_K3_MODEL]: {
      max_completion_tokens: 131072,
      stream_options: { include_usage: true },
    },
  };
  const requestExtras = requestExtrasByModel[model];
  if (!requestExtras) throw new Error("unsupported model");

  return {
    client: createOpenRouterOpenAI(),
    requestModel: model,
    requestExtras,
    persistNativeMessages: [
      GPT_56_SOL_MODEL,
      CLAUDE_OPUS_5_MODEL,
      GROK_46_MODEL,
      KIMI_K3_MODEL,
    ].includes(model),
    strictTools: model === GPT_56_SOL_MODEL || model === GROK_46_MODEL,
  };
}

function buildAssistantMessage(completion, toolCalls) {
  return {
    role: "assistant",
    content: completion.text,
    ...(completion.reasoning ? { reasoning: completion.reasoning } : {}),
    ...(!completion.reasoning && completion.reasoningContent
      ? { reasoning_content: completion.reasoningContent }
      : {}),
    ...(completion.reasoningDetails.length
      ? { reasoning_details: completion.reasoningDetails }
      : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
  };
}

function chatCompletionsProviderState(model, messages, persistNativeMessages) {
  if (!persistNativeMessages || !messages.length) return null;
  return { chatCompletions: { model, messages } };
}

async function runOpenAICompatibleChat({
  model,
  client,
  requestModel,
  requestExtras,
  textOnly = false,
  persistNativeMessages = false,
  strictTools = false,
  mapToolName = (name) => name,
  restoreToolName = (name) => name,
  messages,
  system,
  tools,
  getTools,
  executeTool,
  signal,
  onText,
  onThought,
}) {
  let requestMessages = await buildOpenAICompatibleMessages(messages, system, model, { textOnly });
  const nativeMessages = [];
  let thought = "";
  let usage = null;
  const hasTools = Boolean(tools?.length);

  for (let pass = 0; pass < (hasTools ? 11 : 1); pass += 1) {
    const activeTools = hasTools
      ? (typeof getTools === "function" ? getTools() : tools)
      : undefined;
    const completion = await streamOpenAIChatCompletion({
      client,
      request: {
        model: requestModel,
        ...requestExtras,
        stream: true,
        messages: requestMessages,
        ...(activeTools?.length
          ? { tools: openAIChatTools(activeTools, mapToolName, strictTools) }
          : {}),
      },
      signal,
      onText: hasTools ? () => {} : onText,
      onThought,
    });
    thought += completion.thought;
    if (completion.usage) usage = completion.usage;

    const assistantMessage = buildAssistantMessage(completion, completion.toolCalls);
    nativeMessages.push(assistantMessage);
    if (!completion.toolCalls.length) {
      if (hasTools && completion.text) onText(completion.text);
      return {
        text: completion.text,
        thought,
        usage,
        providerState: chatCompletionsProviderState(model, nativeMessages, persistNativeMessages),
      };
    }
    if (completion.toolCalls.some((call) => !call?.id || !call?.function?.name)) {
      throw new Error("模型返回了无效的工具调用");
    }

    const toolMessages = [];
    for (const toolCall of completion.toolCalls) {
      const output = await executeTool({
        id: toolCall.id,
        name: restoreToolName(toolCall.function.name),
        arguments: toolCall.function.arguments,
      });
      toolMessages.push({ role: "tool", tool_call_id: toolCall.id, content: output });
    }
    nativeMessages.push(...toolMessages);
    requestMessages = [...requestMessages, assistantMessage, ...toolMessages];
  }

  throw new Error("联网搜索轮次已用完，模型未返回最终回答");
}

export async function runDirectChat(options) {
  const isAbliteration = options.model === ABLITERATED_LARGE_MODEL;
  try {
    const profile = buildChatCompletionProfile(options.model);
    return await runOpenAICompatibleChat({ ...options, ...profile });
  } catch (error) {
    throw isAbliteration ? normalizeAbliterationError(error) : error;
  }
}

export function normalizeProviderError(error) {
  if (error instanceof OpenAI.APIError) {
    const normalized = new Error(error.message || `模型请求失败（${error.status}）`);
    normalized.status = error.status;
    normalized.code = error.code;
    return normalized;
  }
  return error;
}
