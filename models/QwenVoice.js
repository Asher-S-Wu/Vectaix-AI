import crypto from "node:crypto";
import mongoose from "mongoose";

const QwenVoiceSchema = new mongoose.Schema({
  profileId: { type: String, required: true, unique: true, immutable: true, default: () => crypto.randomUUID() },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  voiceId: { type: String, required: true, unique: true, maxlength: 256 },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  status: { type: String, enum: ["created", "training", "trained", "failed"], required: true },
  languages: { type: [String], default: [] },
  consentConfirmedAt: { type: Date, required: true },
  sampleFileName: { type: String, required: true, maxlength: 200 },
  lastStatusCheckedAt: { type: Date, required: true },
}, { timestamps: true });

QwenVoiceSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.QwenVoice || mongoose.model("QwenVoice", QwenVoiceSchema);
