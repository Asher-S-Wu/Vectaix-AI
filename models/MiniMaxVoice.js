import crypto from "node:crypto";
import mongoose from "mongoose";

const MiniMaxVoiceSchema = new mongoose.Schema({
  profileId: { type: String, required: true, unique: true, immutable: true, default: () => crypto.randomUUID() },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  voiceId: { type: String, required: true, unique: true, maxlength: 256 },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  languages: { type: [String], default: [] },
  consentConfirmedAt: { type: Date, required: true },
  sampleFileName: { type: String, required: true, maxlength: 200 },
  needNoiseReduction: { type: Boolean, required: true },
  needVolumeNormalization: { type: Boolean, required: true },
  activatedAt: { type: Date, default: null },
  lastStatusCheckedAt: { type: Date, required: true },
}, { timestamps: true });

MiniMaxVoiceSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.MiniMaxVoice || mongoose.model("MiniMaxVoice", MiniMaxVoiceSchema);
