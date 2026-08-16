import {
  DOUBAO_AUDIO_REFERENCE_EXTENSIONS,
  DOUBAO_AUDIO_REFERENCE_MAX_BYTES,
  DOUBAO_AUDIO_REFERENCE_MAX_DURATION_SECONDS,
} from "@/lib/media/shared/doubaoAudio";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";

function rejectReference(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

export function inspectDoubaoReferenceAudio(input, extension) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    rejectReference("参考音频内容为空");
  }
  if (input.length > DOUBAO_AUDIO_REFERENCE_MAX_BYTES) {
    rejectReference("每段参考音频不能超过 10MB");
  }
  const normalizedExtension = String(extension || "").trim().toLowerCase();
  if (!DOUBAO_AUDIO_REFERENCE_EXTENSIONS.includes(normalizedExtension)) {
    rejectReference("参考音频仅支持 MP3、WAV 或 OGG Opus 格式");
  }
  let metadata;
  try {
    metadata = inspectAudioMetadata(input, normalizedExtension);
  } catch (error) {
    rejectReference(error instanceof Error ? error.message : "参考音频内容无法解析");
  }
  if (metadata.durationSeconds > DOUBAO_AUDIO_REFERENCE_MAX_DURATION_SECONDS) {
    rejectReference("每段参考音频不能超过 30 秒");
  }
  return metadata;
}
