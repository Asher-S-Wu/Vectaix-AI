import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  ABLITERATED_LARGE_MODEL,
  CLAUDE_OPUS_5_MODEL,
  GEMINI_FLASH_MODEL,
  GPT_56_SOL_MODEL,
  GROK_45_MODEL,
  KIMI_K3_MODEL,
  QWEN_38_MAX_MODEL,
} from "@/lib/shared/models";
import {
  resolveAbliterationOpenAIConfig,
  resolveOpenRouterAnthropicConfig,
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

function createOpenRouterAnthropic() {
  const config = resolveOpenRouterAnthropicConfig();
  return new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
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

async function toOpenAICompatibleContent(content, role) {
  if (!Array.isArray(content)) return String(content || "");
  const result = [];
  for (const part of content) {
    if (typeof part?.text === "string") {
      result.push({ type: "text", text: part.text });
      continue;
    }
    const url = imageUrl(part);
    if (url && role === "user") {
      result.push({ type: "image_url", image_url: { url } });
      continue;
    }
    const privateMedia = part?.type === "private_media" ? part.media : null;
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

async function buildOpenAICompatibleMessages(messages, system) {
  const result = system ? [{ role: "system", content: system }] : [];
  for (const message of messages || []) {
    const role = message?.role === "assistant" ? "assistant" : "user";
    result.push({ role, content: await toOpenAICompatibleContent(message?.content, role) });
  }
  return result;
}

function openAIChatTools(tools, mapToolName = (name) => name) {
  return (tools || []).map((tool) => ({
    type: "function",
    function: { ...tool, name: mapToolName(tool.name) },
  }));
}

function mergeOpenAIReasoningDetailObject(current, fragment) {
  const merged = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  for (const [key, value] of Object.entries(fragment)) {
    if (value === undefined || value === null) continue;
    if (key === "type") {
      merged.type = value;
    } else if (typeof value === "string") {
      merged[key] = `${typeof merged[key] === "string" ? merged[key] : ""}${value}`;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeOpenAIReasoningDetails(current, fragment) {
  if (!fragment || typeof fragment !== "object") return current;
  if (!Array.isArray(fragment) && !Array.isArray(current)) {
    return mergeOpenAIReasoningDetailObject(current, fragment);
  }

  const mergedItems = Array.isArray(current) ? current.slice() : (current ? [current] : []);
  const fragments = Array.isArray(fragment) ? fragment : [fragment];
  for (const item of fragments) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const lastIndex = mergedItems.length - 1;
    const lastItem = lastIndex >= 0 ? mergedItems[lastIndex] : null;
    const continuesLastType = lastItem && (!item.type || !lastItem.type || item.type === lastItem.type);
    if (continuesLastType) {
      mergedItems[lastIndex] = mergeOpenAIReasoningDetailObject(lastItem, item);
    } else {
      mergedItems.push(mergeOpenAIReasoningDetailObject(null, item));
    }
  }
  return mergedItems.length ? mergedItems : current;
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
  let reasoningDetails = null;
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
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        thought += delta.reasoning_content;
        onThought(delta.reasoning_content);
      }
      reasoningDetails = mergeOpenAIReasoningDetails(reasoningDetails, delta.reasoning_details);
      mergeOpenAIToolCalls(toolCallsByIndex, delta.tool_calls);
    }
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call);
  return { text, thought, reasoningDetails, toolCalls, usage };
}

function openRouterChatRequestExtras(model) {
  if (model === GEMINI_FLASH_MODEL) {
    return { reasoning_effort: "high", max_completion_tokens: 65536 };
  }
  return {};
}

function toQwenToolName(name) {
  return name === WebBrowsingApiName.search ? QWEN_WEB_SEARCH_TOOL_NAME : name;
}

function fromQwenToolName(name) {
  return name === QWEN_WEB_SEARCH_TOOL_NAME ? WebBrowsingApiName.search : name;
}

async function runOpenAICompatibleChat({
  client,
  requestModel,
  requestExtras = {},
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
  let requestMessages = await buildOpenAICompatibleMessages(messages, system);
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
        ...(activeTools?.length ? { tools: openAIChatTools(activeTools, mapToolName) } : {}),
      },
      signal,
      onText: hasTools ? () => {} : onText,
      onThought,
    });
    thought += completion.thought;
    if (completion.usage) usage = completion.usage;

    if (!completion.toolCalls.length) {
      if (hasTools && completion.text) onText(completion.text);
      return { text: completion.text, thought, usage };
    }

    const toolCall = completion.toolCalls[0];
    const assistantMessage = {
      role: "assistant",
      content: completion.text,
      ...(completion.thought ? { reasoning_content: completion.thought } : {}),
      ...(completion.reasoningDetails ? { reasoning_details: completion.reasoningDetails } : {}),
      tool_calls: [toolCall],
    };
    if (!toolCall?.id || !toolCall?.function?.name) {
      throw new Error("模型返回了无效的工具调用");
    }
    const output = await executeTool({
      id: toolCall.id,
      name: restoreToolName(toolCall.function.name),
      arguments: toolCall.function.arguments,
    });
    requestMessages = [
      ...requestMessages,
      assistantMessage,
      { role: "tool", tool_call_id: toolCall.id, content: output },
    ];
  }

  throw new Error("联网搜索轮次已用完，模型未返回最终回答");
}

function runOpenRouterChat(options) {
  return runOpenAICompatibleChat({
    ...options,
    client: createOpenRouterOpenAI(),
    requestModel: options.model,
    requestExtras: openRouterChatRequestExtras(options.model),
  });
}

function runQwenChat(options) {
  return runOpenAICompatibleChat({
    ...options,
    client: createQwenOpenAI(),
    requestModel: QWEN_38_MAX_UPSTREAM_MODEL,
    requestExtras: {
      enable_thinking: true,
      preserve_thinking: false,
      stream_options: { include_usage: true },
    },
    mapToolName: toQwenToolName,
    restoreToolName: fromQwenToolName,
  });
}

function imageUrl(part) {
  return typeof part?.image_url === "string" ? part.image_url : part?.image_url?.url;
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(String(value || ""));
  return match ? { mimeType: match[1].toLowerCase(), data: match[2] } : null;
}

function buildResponsesInput(messages, {
  textOnly = false,
  reuseNativeOutput = true,
} = {}) {
  const input = [];
  for (const message of messages || []) {
    if (
      reuseNativeOutput
      && message?.role === "assistant"
      && Array.isArray(message?.providerState?.responses?.output)
    ) {
      input.push(...message.providerState.responses.output);
      continue;
    }
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = Array.isArray(message?.content)
      ? message.content.map((part) => {
        if (textOnly) {
          const isTextPart = (
            typeof part?.text === "string"
            && !imageUrl(part)
            && !part?.media
          );
          if (!isTextPart) {
            throw createAbliterationServiceError(
              "Abliterated Model Large 仅支持纯文本输入",
              400,
              "ABLITERATION_UNSUPPORTED_INPUT"
            );
          }
          return { type: "input_text", text: part.text };
        }
        if (typeof part?.text === "string") {
          return { type: "input_text", text: part.text };
        }
        const url = imageUrl(part);
        return url && role === "user" ? { type: "input_image", image_url: url, detail: "auto" } : null;
      }).filter(Boolean)
      : [{ type: "input_text", text: String(message?.content || "") }];
    if (content.length) input.push({ role, content });
  }
  return input;
}

function responsesTools(tools, { strict = true } = {}) {
  return (tools || []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(strict ? { strict: true } : {}),
  }));
}

function responseThought(response) {
  return (response?.output || []).flatMap((item) => item?.type === "reasoning" ? item.summary || [] : [])
    .map((item) => item?.text || "").join("\n").trim();
}

function responseToolCalls(response) {
  return (response?.output || []).filter((item) => item?.type === "function_call").map((item) => ({
    id: item.call_id,
    name: item.name,
    arguments: item.arguments,
  }));
}

function buildResponsesReasoning(model) {
  return model === GPT_56_SOL_MODEL
    ? { mode: "standard", effort: "max", summary: "auto", context: "all_turns" }
    : { effort: "high", summary: "auto" };
}

function buildResponsesProfile({ model, system, cacheKey }) {
  if (model === ABLITERATED_LARGE_MODEL) {
    return {
      client: createAbliterationOpenAI(),
      requestBase: {
        model,
        instructions: system,
        reasoning: { effort: "max" },
        max_output_tokens: 131072,
      },
      handleAllToolCalls: true,
      persistNativeOutput: false,
      requireCompleted: true,
      strictTools: false,
      usePreviousResponseId: true,
    };
  }

  return {
    client: createOpenRouterOpenAI(),
    requestBase: {
      model,
      instructions: system,
      reasoning: buildResponsesReasoning(model),
      store: false,
      include: ["reasoning.encrypted_content"],
      ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
      ...(model === GPT_56_SOL_MODEL ? {
        max_output_tokens: 128000,
        text: { verbosity: "high" },
      } : {}),
    },
    handleAllToolCalls: false,
    persistNativeOutput: true,
    requireCompleted: false,
    strictTools: true,
    usePreviousResponseId: false,
  };
}

function responsesProviderState(nativeItems, persistNativeOutput) {
  return persistNativeOutput ? { responses: { output: nativeItems } } : null;
}

function assertAbliterationResponseCompleted(response) {
  if (response?.status === "completed") return;
  throw createAbliterationServiceError(
    "Abliteration 模型响应未正常完成，请稍后再试",
    502,
    "ABLITERATION_RESPONSE_INCOMPLETE"
  );
}

async function runResponses({ model, messages, system, tools, getTools, executeTool, cacheKey, signal, onText, onThought }) {
  const isAbliteration = model === ABLITERATED_LARGE_MODEL;
  try {
    const profile = buildResponsesProfile({ model, system, cacheKey });
    const input = buildResponsesInput(messages, {
      textOnly: isAbliteration,
      reuseNativeOutput: !isAbliteration,
    });
    const nativeItems = [];

    if (!tools?.length) {
      const stream = await profile.client.responses.create({
        ...profile.requestBase,
        input,
        stream: true,
      }, { signal });
      let text = "";
      let thought = "";
      let completed = null;
      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta) {
          text += event.delta;
          onText(event.delta);
        } else if (event.type === "response.reasoning_summary_text.delta" && event.delta) {
          thought += event.delta;
          onThought(event.delta);
        } else if (event.type === "response.completed") {
          completed = event.response;
        }
      }
      if (profile.requireCompleted) assertAbliterationResponseCompleted(completed);
      if (isAbliteration && !thought) {
        const completedThought = responseThought(completed);
        if (completedThought) {
          thought = completedThought;
          onThought(completedThought);
        }
      }
      if (profile.persistNativeOutput) nativeItems.push(...(completed?.output || []));
      return {
        text,
        thought,
        usage: completed?.usage || null,
        providerState: responsesProviderState(nativeItems, profile.persistNativeOutput),
      };
    }

    let currentInput = input;
    let previousResponseId = null;
    let finalResponse = null;
    for (let pass = 0; pass < 11; pass += 1) {
      const activeTools = typeof getTools === "function" ? getTools() : tools;
      const response = await profile.client.responses.create({
        ...profile.requestBase,
        input: currentInput,
        ...(isAbliteration ? { stream: false } : {}),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        ...(activeTools?.length ? {
          tools: responsesTools(activeTools, { strict: profile.strictTools }),
        } : {}),
      }, { signal });
      finalResponse = response;
      const output = response.output || [];
      if (profile.persistNativeOutput) nativeItems.push(...output);
      const thought = responseThought(response);
      if (thought) onThought(thought);
      const allCalls = responseToolCalls(response);
      const calls = profile.handleAllToolCalls ? allCalls : allCalls.slice(0, 1);
      if (!calls.length) {
        if (profile.requireCompleted) assertAbliterationResponseCompleted(response);
        const text = response.output_text || "";
        if (text) onText(text);
        return {
          text,
          thought,
          usage: response.usage || null,
          providerState: responsesProviderState(nativeItems, profile.persistNativeOutput),
        };
      }
      if (calls.some((call) => !call?.id || !call?.name)) {
        throw new Error("模型返回了无效的工具调用");
      }

      const results = [];
      for (const call of calls) {
        const outputText = await executeTool(call);
        const result = { type: "function_call_output", call_id: call.id, output: outputText };
        results.push(result);
        if (profile.persistNativeOutput) nativeItems.push(result);
      }

      if (profile.usePreviousResponseId) {
        if (!response.id) {
          throw createAbliterationServiceError(
            "Abliteration 模型返回了无效的工具调用状态",
            502,
            "ABLITERATION_TOOL_STATE_INVALID"
          );
        }
        previousResponseId = response.id;
        currentInput = results;
      } else {
        currentInput = [...currentInput, ...output, ...results];
      }
    }
    throw new Error(finalResponse ? "联网搜索轮次已用完，模型未返回最终回答" : "模型未返回结果");
  } catch (error) {
    throw isAbliteration ? normalizeAbliterationError(error) : error;
  }
}

function toClaudeContent(content, role) {
  if (!Array.isArray(content)) return [{ type: "text", text: String(content || "") }];
  return content.map((part) => {
    if (typeof part?.text === "string") return { type: "text", text: part.text };
    const image = parseDataUrl(imageUrl(part));
    return image && role === "user"
      ? { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } }
      : null;
  }).filter(Boolean);
}

function buildClaudeMessages(messages) {
  const result = [];
  for (const message of messages || []) {
    if (message?.role === "assistant" && Array.isArray(message?.providerState?.anthropic?.messages)) {
      result.push(...message.providerState.anthropic.messages);
      continue;
    }
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = toClaudeContent(message?.content, role);
    if (content.length) result.push({ role, content });
  }
  return result;
}

function claudeTools(tools) {
  return (tools || []).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
}

function claudeText(blocks) {
  return (blocks || []).filter((block) => block?.type === "text").map((block) => block.text || "").join("");
}

function claudeThought(blocks) {
  return (blocks || []).filter((block) => block?.type === "thinking").map((block) => block.thinking || "").join("\n");
}

async function runClaude({ messages, system, tools, getTools, executeTool, signal, onText, onThought }) {
  const client = createOpenRouterAnthropic();
  const base = {
    model: CLAUDE_OPUS_5_MODEL,
    max_tokens: 128000,
    system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "max" },
    cache_control: { type: "ephemeral" },
  };
  const nativeMessages = [];
  let requestMessages = buildClaudeMessages(messages);

  if (!tools?.length) {
    const stream = client.messages.stream({ ...base, messages: requestMessages }, { signal });
    let text = "";
    let thought = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text;
        onText(event.delta.text);
      } else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
        thought += event.delta.thinking;
        onThought(event.delta.thinking);
      }
    }
    const final = await stream.finalMessage();
    nativeMessages.push({ role: "assistant", content: final.content });
    return { text, thought, usage: final.usage || null, providerState: { anthropic: { messages: nativeMessages } } };
  }

  for (let pass = 0; pass < 11; pass += 1) {
    const activeTools = typeof getTools === "function" ? getTools() : tools;
    const response = await client.messages.create({
      ...base,
      messages: requestMessages,
      ...(activeTools?.length ? { tools: claudeTools(activeTools) } : {}),
    }, { signal });
    const assistantMessage = { role: "assistant", content: response.content };
    nativeMessages.push(assistantMessage);
    const thought = claudeThought(response.content);
    if (thought) onThought(thought);
    const calls = response.content.filter((block) => block?.type === "tool_use").slice(0, 1);
    if (!calls.length) {
      const text = claudeText(response.content);
      if (text) onText(text);
      return { text, thought, usage: response.usage || null, providerState: { anthropic: { messages: nativeMessages } } };
    }
    const toolResults = [];
    for (const call of calls) {
      const output = await executeTool({ id: call.id, name: call.name, arguments: call.input });
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: output });
    }
    const toolMessage = { role: "user", content: toolResults };
    nativeMessages.push(toolMessage);
    requestMessages = [...requestMessages, assistantMessage, toolMessage];
  }
  throw new Error("联网搜索轮次已用完，模型未返回最终回答");
}

function toKimiContent(content, role) {
  if (!Array.isArray(content)) return String(content || "");
  const result = [];
  for (const part of content) {
    if (typeof part?.text === "string") {
      result.push({ type: "text", text: part.text });
      continue;
    }
    const url = imageUrl(part);
    if (url && role === "user") {
      const image = parseDataUrl(url);
      if (!image) throw new Error("Kimi K3 图像格式无效");
      result.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType,
          data: image.data,
        },
      });
      continue;
    }
    const privateMedia = part?.type === "private_media" ? part.media : null;
    if (privateMedia && role === "user") {
      throw new Error("Kimi K3 的 Anthropic Messages 协议不支持音频或视频输入");
    }
  }
  return result;
}

function buildKimiMessages(messages) {
  const result = [];
  for (const message of messages || []) {
    if (message?.role === "assistant" && Array.isArray(message?.providerState?.kimi?.messages)) {
      result.push(...message.providerState.kimi.messages);
    } else {
      const role = message?.role === "assistant" ? "assistant" : "user";
      result.push({ role, content: toKimiContent(message?.content, role) });
    }
  }
  return result;
}

function kimiTools(tools) {
  return (tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

async function streamKimiMessage({ client, request, signal, onText, onThought }) {
  const stream = client.messages.stream(request, { signal });
  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    if (event.delta?.type === "text_delta" && event.delta.text) {
      onText(event.delta.text);
    } else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
      onThought(event.delta.thinking);
    }
  }
  return stream.finalMessage();
}

async function runKimi({ messages, system, tools, getTools, executeTool, signal, onText, onThought }) {
  const client = createOpenRouterAnthropic();
  let requestMessages = buildKimiMessages(messages);
  const nativeMessages = [];
  const base = {
    model: KIMI_K3_MODEL,
    max_tokens: 131072,
    ...(system ? { system } : {}),
  };
  if (!tools?.length) {
    const message = await streamKimiMessage({
      client,
      request: { ...base, messages: requestMessages },
      signal,
      onText,
      onThought,
    });
    const text = claudeText(message.content);
    const thought = claudeThought(message.content);
    nativeMessages.push({ role: "assistant", content: message.content });
    return {
      text,
      thought,
      usage: message.usage || null,
      providerState: { kimi: { messages: nativeMessages } },
    };
  }

  let thought = "";
  let usage = null;
  for (let pass = 0; pass < 11; pass += 1) {
    const activeTools = typeof getTools === "function" ? getTools() : tools;
    const message = await streamKimiMessage({
      client,
      request: {
        ...base,
        messages: requestMessages,
        ...(activeTools?.length ? { tools: kimiTools(activeTools) } : {}),
      },
      signal,
      onText: () => {},
      onThought,
    });
    const passThought = claudeThought(message.content);
    if (passThought) thought = thought ? `${thought}\n${passThought}` : passThought;
    usage = message.usage || usage;

    const toolCalls = (message.content || []).filter((block) => block?.type === "tool_use");
    const assistantMessage = { role: "assistant", content: message.content };
    nativeMessages.push(assistantMessage);
    if (!toolCalls.length) {
      const text = claudeText(message.content);
      if (text) onText(text);
      return {
        text,
        thought,
        usage,
        providerState: { kimi: { messages: nativeMessages } },
      };
    }
    if (toolCalls.some((toolCall) => !toolCall?.id || !toolCall?.name)) {
      throw new Error("Kimi K3 返回了无效的工具调用");
    }
    const toolResults = [];
    for (const toolCall of toolCalls) {
      const output = await executeTool({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.input,
      });
      toolResults.push({ type: "tool_result", tool_use_id: toolCall.id, content: output });
    }
    const toolMessage = { role: "user", content: toolResults };
    nativeMessages.push(toolMessage);
    requestMessages = [...requestMessages, assistantMessage, toolMessage];
  }
  throw new Error("联网搜索轮次已用完，模型未返回最终回答");
}

export async function runDirectChat(options) {
  if (options.model === GEMINI_FLASH_MODEL) return runOpenRouterChat(options);
  if (
    options.model === ABLITERATED_LARGE_MODEL
    || options.model === GPT_56_SOL_MODEL
    || options.model === GROK_45_MODEL
  ) return runResponses(options);
  if (options.model === CLAUDE_OPUS_5_MODEL) return runClaude(options);
  if (options.model === KIMI_K3_MODEL) return runKimi(options);
  if (options.model === QWEN_38_MAX_MODEL) return runQwenChat(options);
  throw new Error("unsupported model");
}

export function normalizeProviderError(error) {
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError) {
    const normalized = new Error(error.message || `模型请求失败（${error.status}）`);
    normalized.status = error.status;
    normalized.code = error.code;
    return normalized;
  }
  return error;
}
