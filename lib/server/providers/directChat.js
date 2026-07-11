import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import {
  CLAUDE_OPUS_MODEL,
  GEMINI_FLASH_MODEL,
  GLM_52_MODEL,
  GPT_56_SOL_MODEL,
  GROK_45_MODEL,
} from "@/lib/shared/models";
import {
  resolveGeminiProviderConfig,
  resolveInfereraAnthropicConfig,
  resolveInfereraOpenAIConfig,
} from "@/lib/modelRoutes";

function createInfereraOpenAI() {
  const config = resolveInfereraOpenAIConfig();
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.openAIBaseUrl });
}

function createInfereraAnthropic() {
  const config = resolveInfereraAnthropicConfig();
  return new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
}

function createGemini() {
  return new GoogleGenAI(resolveGeminiProviderConfig());
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
}

function imageUrl(part) {
  return typeof part?.image_url === "string" ? part.image_url : part?.image_url?.url;
}

function buildResponsesInput(messages) {
  const input = [];
  for (const message of messages || []) {
    if (message?.role === "assistant" && Array.isArray(message?.providerState?.responses?.output)) {
      input.push(...message.providerState.responses.output);
      continue;
    }
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = Array.isArray(message?.content)
      ? message.content.map((part) => {
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

function responsesTools(tools) {
  return (tools || []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
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

async function runResponses({ model, messages, system, tools, getTools, executeTool, cacheKey, signal, onText, onThought }) {
  const client = createInfereraOpenAI();
  const input = buildResponsesInput(messages);
  const nativeItems = [];
  const requestBase = {
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
  };

  if (!tools?.length) {
    const stream = await client.responses.create({ ...requestBase, input, stream: true }, { signal });
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
    nativeItems.push(...(completed?.output || []));
    return { text, thought, usage: completed?.usage || null, providerState: { responses: { output: nativeItems } } };
  }

  let currentInput = input;
  let finalResponse = null;
  for (let pass = 0; pass < 11; pass += 1) {
    const activeTools = typeof getTools === "function" ? getTools() : tools;
    const response = await client.responses.create({
      ...requestBase,
      input: currentInput,
      ...(activeTools?.length ? { tools: responsesTools(activeTools) } : {}),
    }, { signal });
    finalResponse = response;
    const output = response.output || [];
    nativeItems.push(...output);
    const thought = responseThought(response);
    if (thought) onThought(thought);
    const calls = responseToolCalls(response).slice(0, 1);
    if (!calls.length) {
      const text = response.output_text || "";
      if (text) onText(text);
      return { text, thought, usage: response.usage || null, providerState: { responses: { output: nativeItems } } };
    }
    const results = [];
    for (const call of calls) {
      const outputText = await executeTool(call);
      const result = { type: "function_call_output", call_id: call.id, output: outputText };
      results.push(result);
      nativeItems.push(result);
    }
    currentInput = [...currentInput, ...output, ...results];
  }
  throw new Error(finalResponse ? "联网搜索轮次已用完，模型未返回最终回答" : "模型未返回结果");
}

function toClaudeContent(content, role) {
  if (!Array.isArray(content)) return [{ type: "text", text: String(content || "") }];
  return content.map((part) => {
    if (typeof part?.text === "string") return { type: "text", text: part.text };
    const url = imageUrl(part);
    return url && role === "user" ? { type: "image", source: { type: "url", url } } : null;
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
  const client = createInfereraAnthropic();
  const base = {
    model: CLAUDE_OPUS_MODEL,
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

function toGeminiContent(content, role) {
  if (!Array.isArray(content)) return [{ type: "text", text: String(content || "") }];
  return content.map((part) => {
    if (typeof part?.text === "string") return { type: "text", text: part.text };
    const url = imageUrl(part);
    return url && role === "user" ? { type: "image", uri: url, mime_type: "image/jpeg" } : null;
  }).filter(Boolean);
}

function buildGeminiInput(messages) {
  const steps = [];
  for (const message of messages || []) {
    if (message?.role === "assistant" && Array.isArray(message?.providerState?.gemini?.steps)) {
      steps.push(...message.providerState.gemini.steps);
      continue;
    }
    const role = message?.role === "assistant" ? "model" : "user";
    const content = toGeminiContent(message?.content, role);
    if (!content.length) continue;
    steps.push(role === "user" ? { type: "user_input", content } : { type: "model_output", content });
  }
  return steps;
}

function geminiOutputText(outputs) {
  return (outputs || []).filter((step) => step?.type === "model_output")
    .flatMap((step) => step.content || []).filter((item) => item?.type === "text")
    .map((item) => item.text || "").join("");
}

function geminiThought(outputs) {
  return (outputs || []).filter((step) => step?.type === "thought")
    .flatMap((step) => step.summary || []).filter((item) => item?.type === "text")
    .map((item) => item.text || "").join("\n");
}

async function runGemini({ messages, system, tools, getTools, executeTool, signal, onText, onThought }) {
  const client = createGemini();
  const nativeSteps = [];
  let input = buildGeminiInput(messages);
  const base = {
    model: GEMINI_FLASH_MODEL,
    store: false,
    system_instruction: system,
    generation_config: {
      thinking_level: "high",
      thinking_summaries: "auto",
      max_output_tokens: 65536,
    },
  };

  if (!tools?.length) {
    const stream = await client.interactions.create({ ...base, input, stream: true }, { signal });
    let text = "";
    let thought = "";
    let usage = null;
    for await (const event of stream) {
      if (event.event_type === "step.delta" && event.delta?.type === "text") {
        const delta = event.delta.text || "";
        text += delta;
        onText(delta);
        const step = nativeSteps[event.index];
        if (step?.type === "model_output") {
          if (!Array.isArray(step.content)) step.content = [];
          const last = step.content[step.content.length - 1];
          if (last?.type === "text") last.text = `${last.text || ""}${delta}`;
          else step.content.push({ type: "text", text: delta });
        }
      } else if (event.event_type === "step.delta" && event.delta?.type === "thought_summary") {
        const delta = event.delta.content?.text || "";
        thought += delta;
        onThought(delta);
        const step = nativeSteps[event.index];
        if (step?.type === "thought") {
          if (!Array.isArray(step.summary)) step.summary = [];
          const last = step.summary[step.summary.length - 1];
          if (last?.type === "text") last.text = `${last.text || ""}${delta}`;
          else step.summary.push({ type: "text", text: delta });
        }
      } else if (event.event_type === "step.delta" && event.delta?.type === "thought_signature") {
        const step = nativeSteps[event.index];
        if (step?.type === "thought" && event.delta.signature) step.signature = event.delta.signature;
      } else if (event.event_type === "step.start" && event.step) {
        nativeSteps[event.index] = event.step;
      } else if (event.event_type === "interaction.completed") {
        usage = event.interaction?.usage || event.metadata?.total_usage || null;
        if (Array.isArray(event.interaction?.steps)) nativeSteps.splice(0, nativeSteps.length, ...event.interaction.steps);
      }
    }
    return { text, thought, usage, providerState: { gemini: { steps: nativeSteps.filter(Boolean) } } };
  }

  for (let pass = 0; pass < 11; pass += 1) {
    const activeTools = typeof getTools === "function" ? getTools() : tools;
    const interaction = await client.interactions.create({
      ...base,
      input,
      ...(activeTools?.length ? { tools: activeTools } : {}),
    }, { signal });
    const outputs = interaction.outputs || interaction.steps || [];
    nativeSteps.push(...outputs);
    const thought = geminiThought(outputs);
    if (thought) onThought(thought);
    const calls = outputs.filter((step) => step?.type === "function_call").slice(0, 1);
    if (!calls.length) {
      const text = interaction.output_text || geminiOutputText(outputs);
      if (text) onText(text);
      return { text, thought, usage: interaction.usage || null, providerState: { gemini: { steps: nativeSteps } } };
    }
    const results = [];
    for (const call of calls) {
      const output = await executeTool({ id: call.id, name: call.name, arguments: call.arguments });
      results.push({ type: "function_result", call_id: call.id, name: call.name, result: output });
    }
    nativeSteps.push(...results);
    input = [...input, ...outputs, ...results];
  }
  throw new Error("联网搜索轮次已用完，模型未返回最终回答");
}

function buildGlmMessages(messages, system) {
  const result = system ? [{ role: "system", content: system }] : [];
  for (const message of messages || []) {
    if (message?.role === "assistant" && Array.isArray(message?.providerState?.glm?.messages)) {
      result.push(...message.providerState.glm.messages);
    } else {
      result.push({ role: message?.role === "assistant" ? "assistant" : "user", content: message?.content });
    }
  }
  return result;
}

async function runGlm({ messages, system, tools, getTools, executeTool, signal, onText, onThought }) {
  const client = createInfereraOpenAI();
  let requestMessages = buildGlmMessages(messages, system);
  const nativeMessages = [];
  const base = {
    model: GLM_52_MODEL,
    thinking: { type: "enabled", clear_thinking: false },
    reasoning_effort: "max",
    max_completion_tokens: 128000,
  };
  if (!tools?.length) {
    const stream = await client.chat.completions.create({ ...base, messages: requestMessages, stream: true, stream_options: { include_usage: true } }, { signal });
    let text = "";
    let thought = "";
    let usage = null;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta || {};
      if (delta.content) { text += delta.content; onText(delta.content); }
      const reasoning = delta.reasoning_content || delta.reasoning || "";
      if (reasoning) { thought += reasoning; onThought(reasoning); }
      if (chunk.usage) usage = chunk.usage;
    }
    nativeMessages.push({ role: "assistant", content: text, reasoning_content: thought });
    return { text, thought, usage, providerState: { glm: { messages: nativeMessages } } };
  }
  for (let pass = 0; pass < 11; pass += 1) {
    const activeTools = typeof getTools === "function" ? getTools() : tools;
    const response = await client.chat.completions.create({
      ...base,
      messages: requestMessages,
      ...(activeTools?.length ? { tools: activeTools.map((tool) => ({ type: "function", function: tool })) } : {}),
    }, { signal });
    const message = response.choices?.[0]?.message || {};
    const thought = message.reasoning_content || message.reasoning || "";
    const assistantMessage = {
      role: "assistant",
      content: message.content || "",
      reasoning_content: thought,
      tool_calls: message.tool_calls || [],
    };
    nativeMessages.push(assistantMessage);
    if (thought) onThought(thought);
    const calls = (message.tool_calls || []).slice(0, 1).map((call) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments }));
    if (!calls.length) {
      const text = contentText(message.content);
      if (text) onText(text);
      return { text, thought, usage: response.usage || null, providerState: { glm: { messages: nativeMessages } } };
    }
    const toolMessages = [];
    for (const call of calls) {
      const output = await executeTool(call);
      toolMessages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
    nativeMessages.push(...toolMessages);
    requestMessages = [...requestMessages, assistantMessage, ...toolMessages];
  }
  throw new Error("联网搜索轮次已用完，模型未返回最终回答");
}

export async function runDirectChat(options) {
  if (options.model === GPT_56_SOL_MODEL || options.model === GROK_45_MODEL) return runResponses(options);
  if (options.model === CLAUDE_OPUS_MODEL) return runClaude(options);
  if (options.model === GEMINI_FLASH_MODEL) return runGemini(options);
  if (options.model === GLM_52_MODEL) return runGlm(options);
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
