import {
  fetchImageAsBase64,
  getStoredPartsFromMessage,
  injectCurrentTimeSystemReminder,
} from "@/app/api/chat/utils";
import {
  FUSION_SYNTHESIS_LABEL,
  FUSION_SYNTHESIS_MODEL,
} from "@/lib/shared/models";
import {
  getChatCompletionAnnotations,
  getChatCompletionOutputText,
  requestOpenRouterChatCompletionResponse,
} from "@/lib/server/openrouter/openai";

export { parseNativeFusionMarkdown } from "@/lib/shared/fusionNativeMarkdown";

const FUSION_RESULT_MAX_OUTPUT_TOKENS = 128000;
const MAX_RAW_MARKDOWN_CHARS = 20000;
const MAX_NATIVE_FUSION_RESPONSE_CHARS = 500000;
const MAX_FINDING_TEXT_CHARS = 1000;
const HISTORY_USER_SUMMARY_CHARS = 500;
const HISTORY_MODEL_SUMMARY_CHARS = 1200;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, maxChars = MAX_FINDING_TEXT_CHARS) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxChars);
}

function buildAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" && reason ? reason : "FUSION_ABORTED");
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw buildAbortError(signal);
  }
}

function normalizeCitations(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const citations = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const url = normalizeString(item.url, 2048);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const entry = {
      url,
      title: normalizeString(item.title || url, 200) || url,
    };
    const citedText = normalizeString(item.cited_text, 1000);
    if (citedText) entry.cited_text = citedText;
    citations.push(entry);
  }
  return citations;
}

function mergeCitations(...lists) {
  return normalizeCitations(lists.flat());
}

function extractTextFromStoredParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function hasImageParts(parts) {
  return Array.isArray(parts) && parts.some((part) => typeof part?.inlineData?.url === "string" && part.inlineData.url);
}

function extractFusionAnalysisSection(content) {
  const text = normalizeString(content, MAX_RAW_MARKDOWN_CHARS);
  if (!text) return "";
  const match = text.match(/(?:^|\n)#{1,6}\s*综合分析\s*\n([\s\S]*?)(?=\n#{1,6}\s+\S|$)/);
  if (!match?.[1]) return "";
  return match[1].trim();
}

function summarizeFusionUserMessage(message) {
  const parts = getStoredPartsFromMessage(message) || [];
  const text = extractTextFromStoredParts(parts);
  return normalizeString(text, HISTORY_USER_SUMMARY_CHARS);
}

function summarizeFusionModelMessage(message) {
  const analysis = extractFusionAnalysisSection(message?.content);
  if (analysis) {
    return normalizeString(analysis, HISTORY_MODEL_SUMMARY_CHARS);
  }
  return normalizeString(message?.content, HISTORY_MODEL_SUMMARY_CHARS);
}

function formatHistoryRoundMemo(roundIndex, userMessage, modelMessage) {
  const userParts = getStoredPartsFromMessage(userMessage) || [];
  const userSummary = summarizeFusionUserMessage(userMessage) || "（该轮用户未提供可提取的文字问题）";
  const modelSummary = summarizeFusionModelMessage(modelMessage) || "（该轮未能提取有效结论摘要）";
  const lines = [
    `第 ${roundIndex} 轮`,
    `用户问题：${userSummary}`,
    `Fusion 结论：${modelSummary}`,
  ];
  if (hasImageParts(userParts)) {
    lines.push("说明：该轮曾包含图片，后续轮次不会自动继续使用原图。");
  }
  return lines.join("\n");
}

function extractCompletedFusionRounds(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const rounds = [];
  for (let i = 0; i < messages.length; i += 1) {
    const userMessage = messages[i];
    const modelMessage = messages[i + 1];
    if (userMessage?.role !== "user") continue;
    if (modelMessage?.role !== "model") continue;
    rounds.push({ userMessage, modelMessage });
    i += 1;
  }
  return rounds;
}

function buildFusionTurnPrompt({ historyMemo, prompt }) {
  const sections = [];
  if (historyMemo) {
    sections.push(
      [
        "# 历史对话纪要",
        "以下内容是此前 Fusion 对话的结论纪要，只能作为背景参考，不能当作已经再次核验过的新证据。",
        "如果纪要里提到之前出现过图片，也不代表你当前仍然看得到那些旧图；只有本轮重新附带的图片才是你现在真正可见的内容。",
        historyMemo,
      ].join("\n")
    );
  }
  sections.push(
    [
      "# 当前用户问题",
      prompt || "（用户仅上传了图片，未提供文字问题）",
      "请优先回答当前这一轮问题，并在需要时结合上面的历史纪要保持上下文连续。",
    ].join("\n")
  );
  return sections.join("\n\n");
}

export function buildFusionResultState(patch = {}) {
  return {
    modelId: FUSION_SYNTHESIS_MODEL,
    label: FUSION_SYNTHESIS_LABEL,
    status: typeof patch.status === "string" ? patch.status : "pending",
    phase: typeof patch.phase === "string" ? patch.phase : "pending",
    message: typeof patch.message === "string" ? patch.message : "",
  };
}

async function loadImagePayloads(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const result = [];
  for (const image of images) {
    const url = typeof image?.url === "string" ? image.url : "";
    if (!url) continue;
    const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
    const mimeType = normalizeString(image?.mimeType || fetchedMimeType, 128) || fetchedMimeType || "image/jpeg";
    result.push({
      url,
      mimeType,
      base64Data,
      dataUrl: `data:${mimeType};base64,${base64Data}`,
    });
  }
  return result;
}

function buildStoredUserParts(prompt, imagePayloads) {
  const parts = [];
  if (typeof prompt === "string" && prompt.trim()) {
    parts.push({ text: prompt });
  }
  for (const image of imagePayloads) {
    parts.push({
      inlineData: {
        url: image.url,
        mimeType: image.mimeType,
      },
    });
  }
  return parts;
}

async function buildFusionSystemPrompt() {
  return injectCurrentTimeSystemReminder(`你是 Fusion。请直接面向用户给出高质量正式回复。

重要要求：
1. 输出 Markdown
2. 优先回答用户当前问题，必要时结合历史对话纪要保持上下文连续
3. 如果历史纪要与当前问题冲突，以当前问题为准
4. 当问题涉及实时信息、最新动态、具体数据或你不确定的事实时，主动联网搜索核实，并在正文中用 Markdown 链接标注来源；对于常识或你已确定的内容则无需搜索
5. 结论要明确，步骤要可执行，解释要让普通用户能听懂
6. 不要泄露思维链，不要提及内部路由、OpenRouter 或模型协作机制`);
}

async function requestSynthesisText({
  instructions,
  payloadText,
  maxTokens,
  reasoningEffort = "max",
  enableWebSearch = false,
  forceFusion = false,
  signal,
}) {
  throwIfAborted(signal);
  const response = await requestOpenRouterChatCompletionResponse({
    model: FUSION_SYNTHESIS_MODEL,
    system: instructions,
    messages: [{ role: "user", content: payloadText }],
    maxTokens,
    reasoningEffort,
    forceFusion,
    signal,
  });
  const text = getChatCompletionOutputText(response);
  if (!text) {
    throw new Error(`${FUSION_SYNTHESIS_LABEL} 未返回有效内容`);
  }
  return {
    text,
    citations: enableWebSearch ? getChatCompletionAnnotations(response) : [],
  };
}

export async function runFusionAnswer({ historyMemo, prompt, signal }) {
  const instructions = await buildFusionSystemPrompt();
  const { text, citations } = await requestSynthesisText({
    instructions,
    payloadText: buildFusionTurnPrompt({ historyMemo, prompt }),
    maxTokens: FUSION_RESULT_MAX_OUTPUT_TOKENS,
    reasoningEffort: "max",
    enableWebSearch: true,
    forceFusion: true,
    signal,
  });

  const normalized = normalizeString(text, MAX_NATIVE_FUSION_RESPONSE_CHARS);
  if (!normalized) {
    throw new Error(`${FUSION_SYNTHESIS_LABEL} 未返回有效正式回复`);
  }
  return { text: normalized, citations: normalizeCitations(citations) };
}

export async function buildFusionUserInput({ prompt, images }) {
  const imagePayloads = await loadImagePayloads(images);
  return {
    prompt,
    imagePayloads,
    userParts: buildStoredUserParts(prompt, imagePayloads),
  };
}

export function buildFusionHistoryMemo(messages) {
  const rounds = extractCompletedFusionRounds(messages);
  if (rounds.length === 0) return "";
  const sections = rounds.map(({ userMessage, modelMessage }, index) =>
    formatHistoryRoundMemo(index + 1, userMessage, modelMessage)
  );
  return [
    "以下是此前 Fusion 已完成轮次的对话纪要，请只把它当作背景上下文，不要把它当成已经再次核验的新证据。",
    sections.join("\n\n"),
  ].join("\n\n");
}

export function buildFusionFinalMessage({
  modelMessageId,
  content,
  experts,
  analysis,
  citations,
}) {
  const safeExperts = Array.isArray(experts) ? experts : [];
  const expertCitations = safeExperts.length > 0
    ? mergeCitations(...safeExperts.map((expert) => expert.citations))
    : [];
  const finalCitations = mergeCitations(expertCitations, normalizeCitations(citations));
  return {
    id: modelMessageId,
    role: "model",
    content,
    type: "text",
    parts: [{ text: content }],
    citations: finalCitations,
    fusionExperts: safeExperts.map((expert) => ({
      modelId: expert.modelId,
      label: expert.label,
      content: expert.rawMarkdown,
      citations: expert.citations,
      durationMs: expert.durationMs,
    })),
    ...(analysis ? { fusionAnalysis: analysis } : {}),
  };
}
