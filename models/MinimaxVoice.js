import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  MINIMAX_AUDIO_LANGUAGE_IDS,
  MINIMAX_AUDIO_MODEL_IDS,
  MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH,
  MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";

const MinimaxVoiceSchema = new mongoose.Schema({
  profileId: {
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
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH,
  },
  voiceId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    immutable: true,
    minlength: 8,
    maxlength: 256,
    match: /^[A-Za-z][A-Za-z0-9_-]*[A-Za-z0-9]$/,
  },
  status: {
    type: String,
    enum: ["SUBMITTING", "READY"],
    default: "SUBMITTING",
    required: true,
    index: true,
  },
  cloneModel: { type: String, enum: MINIMAX_AUDIO_MODEL_IDS, required: true },
  demoText: {
    type: String,
    required: true,
    maxlength: MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH,
  },
  languageBoost: {
    type: String,
    enum: MINIMAX_AUDIO_LANGUAGE_IDS.filter(Boolean),
    default: null,
  },
  noiseReduction: { type: Boolean, default: false, required: true },
  volumeNormalization: { type: Boolean, default: false, required: true },
  sampleFileId: { type: String, default: null, index: true },
  sampleFileName: { type: String, default: "", maxlength: 200 },
  sampleTokenHash: { type: String, default: null, select: false },
  sampleTokenExpiresAt: { type: Date, default: null },
  demoFileId: { type: String, default: null, index: true },
  requestId: { type: String, default: "", maxlength: 200 },
  consentConfirmedAt: { type: Date, required: true },
}, { timestamps: true });

MinimaxVoiceSchema.index({ userId: 1, status: 1, createdAt: -1 });

export default mongoose.models.MinimaxVoice
  || mongoose.model("MinimaxVoice", MinimaxVoiceSchema);

