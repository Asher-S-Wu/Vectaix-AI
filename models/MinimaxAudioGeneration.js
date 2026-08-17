import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  MINIMAX_AUDIO_EMOTION_IDS,
  MINIMAX_AUDIO_FORMAT_IDS,
  MINIMAX_AUDIO_LANGUAGE_IDS,
  MINIMAX_AUDIO_MODEL_IDS,
  MINIMAX_AUDIO_SAMPLE_RATE_IDS,
  MINIMAX_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";

const MinimaxAudioGenerationSchema = new mongoose.Schema({
  generationId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    immutable: true,
    default: () => crypto.randomUUID(),
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  model: { type: String, enum: MINIMAX_AUDIO_MODEL_IDS, required: true },
  text: { type: String, required: true, maxlength: MINIMAX_AUDIO_TEXT_MAX_LENGTH },
  voiceId: { type: String, required: true, maxlength: 256 },
  voiceName: { type: String, required: true, maxlength: 100 },
  voiceKind: { type: String, enum: ["system", "custom"], required: true },
  emotion: {
    type: String,
    enum: MINIMAX_AUDIO_EMOTION_IDS.filter(Boolean),
    default: null,
  },
  speed: { type: Number, min: 0.5, max: 2, required: true },
  volume: { type: Number, min: 0.1, max: 10, required: true },
  pitch: { type: Number, min: -12, max: 12, required: true },
  languageBoost: {
    type: String,
    enum: MINIMAX_AUDIO_LANGUAGE_IDS.filter(Boolean),
    default: null,
  },
  format: { type: String, enum: MINIMAX_AUDIO_FORMAT_IDS, required: true },
  sampleRate: { type: Number, enum: MINIMAX_AUDIO_SAMPLE_RATE_IDS, required: true },
  characters: { type: Number, min: 0, required: true },
  durationMs: { type: Number, min: 0, required: true },
  requestId: { type: String, required: true, maxlength: 200 },
  traceId: { type: String, default: "", maxlength: 300 },
  audioFileId: { type: String, required: true, index: true },
}, { timestamps: true });

MinimaxAudioGenerationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.MinimaxAudioGeneration
  || mongoose.model("MinimaxAudioGeneration", MinimaxAudioGenerationSchema);

