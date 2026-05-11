import { createSseWriter } from "@/lib/server/chat/sse";

export function createCouncilStreamHelpers(controller) {
  const sse = createSseWriter(controller);
  return {
    sendEvent(payload) {
      sse.send(payload);
    },
    sendText(content) {
      if (!content) return;
      sse.send({ type: "text", content });
    },
    sendCouncilExpertStates(experts) {
      sse.send({ type: "council_expert_states", experts });
    },
    sendCouncilExpertState(expert) {
      sse.send({ type: "council_expert_state", expert });
    },
    sendCouncilAnalysisState(analysis) {
      sse.send({ type: "council_analysis_state", analysis });
    },
    sendCouncilExperts(experts) {
      sse.send({
        type: "council_experts",
        experts: experts.map((expert) => ({
          modelId: expert.modelId,
          label: expert.label,
          content: expert.rawMarkdown,
          citations: expert.citations,
          durationMs: expert.durationMs,
        })),
      });
    },
    sendCouncilExpertResult(expert) {
      sse.send({
        type: "council_expert_result",
        expert: {
          modelId: expert.modelId,
          label: expert.label,
          content: expert.rawMarkdown,
          citations: expert.citations,
          durationMs: expert.durationMs,
        },
      });
    },
    sendCouncilAnalysisResult(analysis) {
      sse.send({ type: "council_analysis_result", analysis });
    },
    sendCouncilResultState(result) {
      sse.send({ type: "council_result_state", result });
    },
    sendCouncilResult(content) {
      sse.send({ type: "council_result", content });
    },
    sendCitations(citations) {
      if (!Array.isArray(citations) || citations.length === 0) return;
      sse.send({ type: "citations", citations });
    },
    sendDone() {
      sse.done();
    },
    sendCouncilTriage(payload) {
      sse.send({ type: "council_triage", ...payload });
    },
  };
}
