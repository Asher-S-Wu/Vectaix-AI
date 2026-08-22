import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  DOUBAO_AUDIO_MODEL,
  DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DoubaoVoiceSchema = new mongoose.Schema({
  profileId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    immutable: true,
    default: () => crypto.randomUUID(),
    match: UUID_PATTERN,
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
    minlength: 1,
    maxlength: DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH,
  },
  model: {
    type: String,
    enum: [DOUBAO_AUDIO_MODEL],
    default: DOUBAO_AUDIO_MODEL,
    required: true,
    immutable: true,
  },
  status: {
    type: String,
    enum: ["READY", "DELETING"],
    default: "READY",
    required: true,
    index: true,
  },
  sampleFileId: { type: String, required: true, index: true, immutable: true },
  sampleFileName: { type: String, required: true, maxlength: 200, immutable: true },
  duration: { type: Number, required: true, min: 1, max: 30, immutable: true },
  sampleRate: { type: Number, required: true, enum: [24000], immutable: true },
  size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024, immutable: true },
  consentConfirmedAt: { type: Date, required: true, immutable: true },
}, { timestamps: true });

DoubaoVoiceSchema.index({ userId: 1, model: 1, status: 1, createdAt: -1 });

export default mongoose.models.DoubaoVoice
  || mongoose.model("DoubaoVoice", DoubaoVoiceSchema);
