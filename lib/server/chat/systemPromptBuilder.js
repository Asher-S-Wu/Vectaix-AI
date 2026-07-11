import { injectCurrentTimeSystemReminder } from "@/app/api/chat/utils";
import { buildWebSearchGuide } from "@/lib/server/chat/webSearchConfig";

export async function buildDirectChatSystemPrompt({
  userSystemPrompt,
  systemPromptSuffix,
  enableWebSearch,
  searchContextSection,
} = {}) {
  const preReminderPrompt = [
    typeof userSystemPrompt === "string" ? userSystemPrompt : "",
    systemPromptSuffix,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
  const baseSystemPrompt = await injectCurrentTimeSystemReminder(preReminderPrompt);
  const webSearchGuide = buildWebSearchGuide(enableWebSearch).trim();

  return [
    baseSystemPrompt,
    webSearchGuide,
    searchContextSection,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
}
