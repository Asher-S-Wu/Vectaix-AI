const MAX_RAW_MARKDOWN_CHARS = 20000;
const MAX_NATIVE_FUSION_RESPONSE_CHARS = 120000;
const MAX_FINDING_TEXT_CHARS = 1000;
const FUSION_ANALYSIS_GROUP_KEYS = ["agreement", "keyDifferences", "partialCoverage", "uniqueInsights", "blindSpots"];
const FUSION_ANALYSIS_MODEL_NAMES = new Set(["GPT", "Claude", "Gemini"]);

const FUSION_NATIVE_PANEL_TITLES = new Set([
  "panel responses",
  "panel response",
  "source responses",
  "sources",
]);
const FUSION_NATIVE_ANALYSIS_TITLES = new Set([
  "analysis",
  "fusion analysis",
]);
const FUSION_NATIVE_PROVIDER_LABELS = {
  openai: "OpenAI",
  google: "Google",
  anthropic: "",
  meta: "Meta",
  mistralai: "Mistral",
  mistral: "Mistral",
  "x-ai": "xAI",
  perplexity: "Perplexity",
};
const FUSION_NATIVE_ANALYSIS_ALIASES = [
  { key: "agreement", patterns: [/^consensus$/i, /^agreement$/i, /共识/] },
  { key: "keyDifferences", patterns: [/^contradictions?$/i, /^key differences?$/i, /^differences?$/i, /分歧|差异/] },
  { key: "partialCoverage", patterns: [/^partial coverage$/i, /^coverage gaps?$/i, /覆盖/] },
  { key: "uniqueInsights", patterns: [/^unique insights?$/i, /^unique points?$/i, /独特|洞察/] },
  { key: "blindSpots", patterns: [/^blind spots?$/i, /^missing points?$/i, /盲点|遗漏/] },
];

function normalizeString(value, maxChars = MAX_FINDING_TEXT_CHARS) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxChars);
}

function normalizeHeadingTitle(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLowerCase()
    : "";
}

function findMarkdownHeading(text, matcher, startIndex = 0) {
  if (typeof text !== "string" || !text) return null;
  const headingRe = /^#{1,6}\s+(.+?)\s*$/gm;
  headingRe.lastIndex = Math.max(0, startIndex);
  let match;
  while ((match = headingRe.exec(text))) {
    const title = match[1]?.trim() || "";
    if (matcher(title, match[0])) {
      return {
        index: match.index,
        end: headingRe.lastIndex,
        title,
        line: match[0],
      };
    }
  }
  return null;
}

function findNativeFusionSectionHeading(text, titles, startIndex = 0) {
  return findMarkdownHeading(
    text,
    (title, line) => /^##\s+/.test(line) && titles.has(normalizeHeadingTitle(title)),
    startIndex
  );
}

function findH1Heading(text, startIndex = 0) {
  return findMarkdownHeading(
    text,
    (_title, line) => /^#\s+/.test(line),
    startIndex
  );
}

function isNativeFusionExpertHeading(title) {
  const text = typeof title === "string" ? title.trim().replace(/^~/, "") : "";
  if (!text) return false;
  return /^[a-z0-9_.-]+\/[a-z0-9_.:/-]+$/i.test(text);
}

function titleCaseModelToken(token) {
  const normalized = token.trim();
  if (!normalized) return "";
  if (/^(gpt|ai|api|vl|llm|r1|v3|o\d+)$/i.test(normalized)) return normalized.toUpperCase();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function formatNativeFusionExpertLabel(rawTitle) {
  const modelId = typeof rawTitle === "string" ? rawTitle.trim().replace(/^~/, "") : "";
  if (!modelId.includes("/")) return modelId || "专家";

  const [provider, ...modelParts] = modelId.split("/");
  const modelName = modelParts.join("/");
  const providerLabel = FUSION_NATIVE_PROVIDER_LABELS[provider.toLowerCase()] ?? titleCaseModelToken(provider);
  const modelLabel = modelName
    .split(/[-_\s/.]+/)
    .map(titleCaseModelToken)
    .filter(Boolean)
    .join(" ");

  return [providerLabel, modelLabel].filter(Boolean).join(" ") || modelId;
}

function parseNativeFusionPanelResponses(sectionText) {
  if (typeof sectionText !== "string" || !sectionText.trim()) return [];

  const expertHeadingRe = /^#{3,6}\s+(.+?)\s*$/gm;
  const headings = [];
  let match;
  while ((match = expertHeadingRe.exec(sectionText))) {
    const title = match[1]?.trim() || "";
    if (!isNativeFusionExpertHeading(title)) continue;
    headings.push({
      index: match.index,
      end: expertHeadingRe.lastIndex,
      title,
    });
  }

  return headings
    .map((heading, index) => {
      const nextHeading = headings[index + 1];
      const modelId = heading.title.replace(/^~/, "").trim();
      const rawMarkdown = sectionText
        .slice(heading.end, nextHeading ? nextHeading.index : sectionText.length)
        .trim()
        .slice(0, MAX_RAW_MARKDOWN_CHARS);

      if (!modelId || !rawMarkdown) return null;
      return {
        modelId,
        label: formatNativeFusionExpertLabel(heading.title),
        rawMarkdown,
        content: rawMarkdown,
        citations: [],
      };
    })
    .filter(Boolean);
}

function normalizeAnalysisModels(models) {
  if (!Array.isArray(models)) return [];
  return Array.from(new Set(
    models
      .filter((model) => typeof model === "string")
      .map((model) => model.trim())
      .filter((model) => FUSION_ANALYSIS_MODEL_NAMES.has(model))
  ));
}

function normalizeAnalysisMarkerLine(line) {
  let text = typeof line === "string" ? line.trim() : "";
  if (!text) return "";
  text = text.replace(/^#{1,6}\s+/, "").trim();
  const boldOnlyMatch = text.match(/^\*\*([^*]+)\*\*:?\s*$/);
  if (boldOnlyMatch?.[1]) text = boldOnlyMatch[1].trim();
  return text.replace(/[:：]\s*$/, "").trim();
}

function getNativeFusionAnalysisKey(line) {
  const marker = normalizeAnalysisMarkerLine(line);
  if (!marker) return "";
  for (const section of FUSION_NATIVE_ANALYSIS_ALIASES) {
    if (section.patterns.some((pattern) => pattern.test(marker))) {
      return section.key;
    }
  }
  return "";
}

function cleanNativeFusionAnalysisText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function inferNativeFusionAnalysisModels(text) {
  const models = [];
  const raw = typeof text === "string" ? text : "";
  if (/(~?openai\/|gpt|chatgpt)/i.test(raw)) models.push("GPT");
  if (/(~?anthropic\/|claude)/i.test(raw)) models.push("Claude");
  if (/(~?google\/|gemini)/i.test(raw)) models.push("Gemini");
  return normalizeAnalysisModels(models);
}

function parseNativeFusionAnalysisItems(blockText) {
  const lines = typeof blockText === "string" ? blockText.split("\n") : [];
  const items = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || current.parts.length === 0) return;
    const raw = current.parts.join(" ");
    const text = cleanNativeFusionAnalysisText(raw);
    if (!text) return;
    items.push({
      text: normalizeString(text, MAX_FINDING_TEXT_CHARS),
      models: inferNativeFusionAnalysisModels(raw),
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
      pushCurrent();
      current = { parts: [trimmed] };
      continue;
    }

    if (current) {
      current.parts.push(trimmed.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ""));
    }
  }

  pushCurrent();

  if (items.length > 0) return items;

  const paragraphText = cleanNativeFusionAnalysisText(blockText);
  if (!paragraphText) return [];
  return [{
    text: normalizeString(paragraphText, MAX_FINDING_TEXT_CHARS),
    models: inferNativeFusionAnalysisModels(blockText),
  }];
}

function parseNativeFusionAnalysis(sectionText) {
  if (typeof sectionText !== "string" || !sectionText.trim()) return null;

  const buffers = Object.fromEntries(FUSION_ANALYSIS_GROUP_KEYS.map((key) => [key, []]));
  let currentKey = "";

  for (const line of sectionText.split("\n")) {
    const nextKey = getNativeFusionAnalysisKey(line);
    if (nextKey) {
      currentKey = nextKey;
      continue;
    }
    if (currentKey) buffers[currentKey].push(line);
  }

  const parsed = {};
  for (const key of FUSION_ANALYSIS_GROUP_KEYS) {
    parsed[key] = parseNativeFusionAnalysisItems(buffers[key].join("\n"));
  }

  return FUSION_ANALYSIS_GROUP_KEYS.some((key) => parsed[key].length > 0) ? parsed : null;
}

export function parseNativeFusionMarkdown(rawText) {
  const normalized = normalizeString(rawText, MAX_NATIVE_FUSION_RESPONSE_CHARS);
  if (!normalized) {
    return { content: "", experts: [], analysis: null };
  }

  const panelHeading = findNativeFusionSectionHeading(normalized, FUSION_NATIVE_PANEL_TITLES);
  const analysisHeading = findNativeFusionSectionHeading(
    normalized,
    FUSION_NATIVE_ANALYSIS_TITLES,
    panelHeading ? panelHeading.end : 0
  );
  const finalHeading = analysisHeading ? findH1Heading(normalized, analysisHeading.end) : null;

  if (!panelHeading && !analysisHeading) {
    return { content: normalizeString(normalized, MAX_RAW_MARKDOWN_CHARS), experts: [], analysis: null };
  }

  const panelEnd = analysisHeading?.index ?? finalHeading?.index ?? normalized.length;
  const panelText = panelHeading
    ? normalized.slice(panelHeading.end, Math.max(panelHeading.end, panelEnd)).trim()
    : "";
  const analysisEnd = finalHeading?.index ?? normalized.length;
  const analysisText = analysisHeading
    ? normalized.slice(analysisHeading.end, Math.max(analysisHeading.end, analysisEnd)).trim()
    : "";
  const beforePanel = panelHeading ? normalized.slice(0, panelHeading.index).trim() : "";
  const content = finalHeading
    ? normalized.slice(finalHeading.index).trim()
    : (beforePanel || normalized);

  return {
    content: normalizeString(content || normalized, MAX_RAW_MARKDOWN_CHARS),
    experts: parseNativeFusionPanelResponses(panelText),
    analysis: parseNativeFusionAnalysis(analysisText),
  };
}
