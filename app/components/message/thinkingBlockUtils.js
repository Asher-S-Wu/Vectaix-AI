import { LoadingSweepText } from "./MessageListHelpers";
import { translate } from "@/lib/shared/i18n.mjs";

export function getTimelineToolLabel(tool, locale) {
  const labels = {
    update_plan: ["更新计划", "Update plan"], save_progress: ["保存进度", "Save progress"],
    list_documents: ["查看项目资料", "List project files"], read_document: ["阅读资料", "Read document"],
    list_library: ["查看文件库", "Browse file library"], read_file: ["读取文件", "Read file"], edit_file: ["编辑文件", "Edit file"],
    load_skill: ["读取技能", "Read skill"], read_skill_file: ["读取技能资料", "Read skill file"], read_skill_image: ["查看技能图片", "View skill image"],
    search_web: ["搜索网页", "Search the web"], read_webpage: ["阅读网页", "Read web page"],
    create_report: ["制作报告", "Create report"], create_table: ["制作表格", "Create spreadsheet"],
    inspect_table: ["查看表格", "Inspect spreadsheet"], transform_table: ["整理表格", "Transform spreadsheet"],
    read_task_step: ["查看任务记录", "Read task history"], media_capabilities: ["查看媒体设置", "Check media settings"],
    list_media: ["查看媒体文件", "List media files"], generate_image: ["生成图片", "Generate image"],
    edit_image: ["编辑图片", "Edit image"], generate_speech: ["生成语音", "Generate speech"],
    browser: ["操作浏览器", "Use browser"],
  };
  if (tool?.startsWith("ext_")) {
    if (tool.endsWith("_resource")) return translate(locale, "读取外部资料", "Read connected resources");
    if (tool.endsWith("_prompt")) return translate(locale, "读取提示模板", "Read prompt template");
    if (tool.endsWith("_files")) return translate(locale, "访问远端文件", "Access remote files");
    return translate(locale, "调用外部工具", "Use connected tool");
  }
  return labels[tool] ? translate(locale, ...labels[tool]) : translate(locale, "执行工具", "Run tool");
}

export function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];
  const normalized = timeline
    .filter((step) => step && typeof step === "object" && step.eventType !== "billing")
    .map((step) => ({
      id: step.id,
      kind: step.kind,
      tool: step.tool,
      eventType: step.eventType,
      status: step.status,
      content: typeof step.content === "string" ? step.content : "",
      query: typeof step.query === "string" ? step.query : "",
      title: typeof step.title === "string" ? step.title : "",
      url: typeof step.url === "string" ? step.url : "",
      message: typeof step.message === "string" ? step.message : "",
      round: Number.isFinite(step.round) ? step.round : null,
      resultCount: Number.isFinite(step.resultCount) ? step.resultCount : null,
      synthetic: step.synthetic === true,
    }))
    .filter((step) => step.kind === "thought" || step.kind === "search" || step.kind === "reader" || step.kind === "tool" || step.kind === "planner" || step.kind === "writer" || step.kind === "image_gen");

  return normalized.reduce((acc, step) => {
    const last = acc[acc.length - 1];
    if (last?.kind === "thought" && step.kind === "thought") {
      acc[acc.length - 1] = {
        ...last,
        id: step.id || last.id,
        status: step.status === "streaming" ? "streaming" : last.status,
        content: [last.content, step.content].filter(Boolean).join("\n\n"),
        synthetic: last.synthetic && step.synthetic,
      };
      return acc;
    }
    acc.push(step);
    return acc;
  }, []);
}

function StepStatusText({ text, active = false }) {
  if (active) {
    return <LoadingSweepText text={text} className="loading-sweep-step" />;
  }
  return <span>{text}</span>;
}

export { StepStatusText };

export function SplitStatusText({ prefix = "", status = "", suffix = "", active = false }) {
  return (
    <span className="inline-flex max-w-full items-center">
      {prefix ? <span className="mr-1.5 shrink-0">{prefix}</span> : null}
      {status ? <StepStatusText text={status} active={active} /> : null}
      {suffix ? <span className={status ? "ml-0.5" : ""}>{suffix}</span> : null}
    </span>
  );
}

export function getDisplayHostname(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
