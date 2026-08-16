import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  DOUBAO_AUDIO_FORMAT_IDS,
  DOUBAO_AUDIO_MODE_IDS,
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_REFERENCE_MAX_COUNT,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";

const DoubaoAudioGenerationSchema = new mongoose.Schema({
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
  model: {
    type: String,
    enum: [DOUBAO_AUDIO_MODEL],
    default: DOUBAO_AUDIO_MODEL,
    required: true,
  },
  mode: {
    type: String,
    enum: DOUBAO_AUDIO_MODE_IDS,
    required: true,
  },
  textPrompt: {
    type: String,
    required: true,
    maxlength: DOUBAO_AUDIO_TEXT_MAX_LENGTH,
  },
  referenceCount: {
    type: Number,
    min: 0,
    max: DOUBAO_AUDIO_REFERENCE_MAX_COUNT,
    required: true,
    validate: {
      validator(value) {
        if (this.mode === "text") return value === 0;
        if (this.mode === "audio-reference") {
          return value >= 1 && value <= DOUBAO_AUDIO_REFERENCE_MAX_COUNT;
        }
        return false;
      },
      message: "参考资源数量与生成方式不匹配",
    },
  },
  format: {
    type: String,
    enum: DOUBAO_AUDIO_FORMAT_IDS,
    required: true,
  },
  speechRate: { type: Number, min: -50, max: 100, required: true },
  subtitleEnabled: { type: Boolean, default: false, required: true },
  hasSubtitle: { type: Boolean, default: false, required: true },
  subtitle: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  duration: { type: Number, min: 0, max: 120, required: true },
  originalDuration: { type: Number, min: 0, max: 120, required: true },
  requestId: { type: String, required: true, trim: true, maxlength: 200 },
  upstreamLogId: { type: String, required: true, trim: true, maxlength: 300 },
  audioFileId: { type: String, required: true, index: true },
}, { timestamps: true });

DoubaoAudioGenerationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.DoubaoAudioGeneration
  || mongoose.model("DoubaoAudioGeneration", DoubaoAudioGenerationSchema);
