import { LoadingSweepText } from "./MessageListHelpers";

export function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];
  const normalized = timeline
    .filter((step) => step && typeof step === "object")
    .map((step) => ({
      id: step.id,
      kind: step.kind,
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
    .filter((step) => step.kind === "thought" || step.kind === "search" || step.kind === "reader" || step.kind === "tool" || step.kind === "planner" || step.kind === "image_gen");

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
