import { CHAT_MODELS, isDirectChatModel } from "@/lib/shared/models";
import { AUDIO_MODEL, IMAGE_MODEL, VIDEO_MODEL } from "@/lib/media/shared/models";
import { MINIMAX_AUDIO_MODELS } from "@/lib/media/shared/minimaxAudio";
import { DOUBAO_AUDIO_MODEL } from "@/lib/media/shared/doubaoAudio";
import { VIDEO_ENHANCEMENT_MODEL } from "@/lib/media/shared/videoEnhancement";

export const GUEST_MODEL_CATALOG = Object.freeze([
  ...CHAT_MODELS.filter((model) => isDirectChatModel(model.id)).map((model) => ({
    id: model.id, name: model.name, type: "chat", href: "/",
  })),
  { id: IMAGE_MODEL, name: "Qwen Image 3.0 Pro", type: "image", href: "/media/image" },
  { id: VIDEO_MODEL, name: "HappyHorse 视频", type: "video", href: "/media/video" },
  { id: AUDIO_MODEL, name: "Qwen 语音", type: "audio", href: "/media/audio" },
  ...MINIMAX_AUDIO_MODELS.map((model) => ({
    id: model.id, name: `MiniMax ${model.label}`, type: "audio", href: "/media/minimax-audio",
  })),
  { id: DOUBAO_AUDIO_MODEL, name: "豆包语音", type: "audio", href: "/media/doubao-audio" },
  { id: VIDEO_ENHANCEMENT_MODEL, name: "视频画质增强", type: "video", href: "/media/video-enhancement" },
].map(Object.freeze));

export function getGuestModel(id) {
  return GUEST_MODEL_CATALOG.find((model) => model.id === id) || null;
}

export function getGuestModels(ids) {
  const allowed = new Set(Array.isArray(ids) ? ids : []);
  return GUEST_MODEL_CATALOG.filter((model) => allowed.has(model.id));
}

export function getGuestEntryPath(guestId, allowedIds) {
  const models = getGuestModels(allowedIds);
  const selected = models.find((model) => model.type === "chat") || models[0];
  if (!selected) return null;
  const base = `/guest/${encodeURIComponent(guestId)}`;
  return selected.type === "chat" ? base : `${base}${selected.href}`;
}
