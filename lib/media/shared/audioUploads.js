export const AUDIO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_UPLOAD_MAX_DURATION_SECONDS = 30 * 60;
export const AUDIO_UPLOAD_EXPIRY_MS = 60 * 60 * 1000;
export const AUDIO_UPLOAD_RATE_LIMIT = Object.freeze({
  limit: 20,
  windowMs: 10 * 60 * 1000,
});

export const AUDIO_UPLOAD_PURPOSES = Object.freeze({
  VOICE_CLONE: "voice-clone",
  DOUBAO_REFERENCE: "doubao-reference",
  MINIMAX_VOICE_CLONE: "minimax-voice-clone",
});

export const AUDIO_UPLOAD_PURPOSE_IDS = Object.freeze(
  Object.values(AUDIO_UPLOAD_PURPOSES),
);

export const AUDIO_UPLOAD_EXTENSIONS = Object.freeze([
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "opus",
  "webm",
]);

export const AUDIO_UPLOAD_ACCEPT = [
  ...AUDIO_UPLOAD_EXTENSIONS.map((extension) => `.${extension}`),
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
].join(",");

export const AUDIO_CLIP_LIMITS = Object.freeze({
  [AUDIO_UPLOAD_PURPOSES.VOICE_CLONE]: Object.freeze({
    minSeconds: 5,
    maxSeconds: 60,
  }),
  [AUDIO_UPLOAD_PURPOSES.DOUBAO_REFERENCE]: Object.freeze({
    minSeconds: 1,
    maxSeconds: 30,
  }),
  [AUDIO_UPLOAD_PURPOSES.MINIMAX_VOICE_CLONE]: Object.freeze({
    minSeconds: 10,
    maxSeconds: 300,
    maxOutputBytes: 20 * 1024 * 1024,
    extensions: Object.freeze(["wav", "mp3", "m4a"]),
  }),
});

export function getAudioClipLimits(purpose) {
  return AUDIO_CLIP_LIMITS[purpose] || null;
}

export function isAudioUploadExtensionAllowed(purpose, extension) {
  const normalized = String(extension || "").toLowerCase();
  const allowed = getAudioClipLimits(purpose)?.extensions;
  return allowed ? allowed.includes(normalized) : AUDIO_UPLOAD_EXTENSIONS.includes(normalized);
}
