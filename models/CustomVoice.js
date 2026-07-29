import crypto from "node:crypto";
import mongoose from "mongoose";

const AUDIO_MODEL = "qwen-audio-3.0-tts-plus";
const LANGUAGE_HINTS = [
  "zh",
  "en",
  "fr",
  "de",
  "ja",
  "ko",
  "ru",
  "pt",
  "th",
  "id",
  "vi",
  "it",
  "es",
  "ms",
  "fil",
  "ar",
];

const VoiceUpdateBackupSchema = new mongoose.Schema({
  displayName: { type: String, required: true, maxlength: 60 },
  sampleFileId: { type: String, default: null },
  sampleFileName: { type: String, default: "", maxlength: 200 },
  sampleTokenHash: { type: String, default: null },
  sampleTokenExpiresAt: { type: Date, default: null },
  sampleExpiresAt: { type: Date, default: null },
  consentConfirmedAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ["DEPLOYING", "OK", "UNDEPLOYED"],
    required: true,
  },
  lastStatusCheckedAt: { type: Date, default: null },
  lastRequestId: { type: String, default: "", maxlength: 200 },
  upstreamModifiedAt: { type: Date, default: null },
}, { _id: false });

const CustomVoiceSchema = new mongoose.Schema({
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
    maxlength: 60,
  },
  prefix: {
    type: String,
    required: true,
    immutable: true,
    minlength: 1,
    maxlength: 10,
    match: /^[A-Za-z0-9]+$/,
  },
  voiceId: {
    type: String,
    maxlength: 200,
    set: (value) => {
      const normalized = String(value || "").trim();
      return normalized || undefined;
    },
  },
  status: {
    type: String,
    enum: ["SUBMITTING", "DEPLOYING", "OK", "UNDEPLOYED", "DELETING"],
    default: "SUBMITTING",
    required: true,
    index: true,
  },
  mutationId: {
    type: String,
    default: null,
    maxlength: 64,
    select: false,
  },
  mutationStartedAt: {
    type: Date,
    default: null,
    select: false,
  },
  remoteCreateUncertain: {
    type: Boolean,
    default: false,
    select: false,
  },
  remoteUpdateUncertain: {
    type: Boolean,
    default: false,
    select: false,
  },
  remoteUpdateStartedAt: {
    type: Date,
    default: null,
    select: false,
  },
  remoteUpdateBackup: {
    type: VoiceUpdateBackupSchema,
    default: null,
    select: false,
  },
  model: {
    type: String,
    enum: [AUDIO_MODEL],
    default: AUDIO_MODEL,
    required: true,
  },
  languageHint: {
    type: String,
    enum: LANGUAGE_HINTS,
    default: "zh",
    required: true,
  },
  enablePreprocess: {
    type: Boolean,
    default: false,
  },
  sampleFileId: {
    type: String,
    default: null,
    index: true,
  },
  sampleFileName: {
    type: String,
    default: "",
    maxlength: 200,
  },
  sampleTokenHash: {
    type: String,
    default: null,
    select: false,
  },
  sampleTokenExpiresAt: {
    type: Date,
    default: null,
  },
  sampleExpiresAt: {
    type: Date,
    default: null,
    index: true,
  },
  consentConfirmedAt: {
    type: Date,
    default: null,
  },
  upstreamCreatedAt: {
    type: Date,
    default: null,
  },
  upstreamModifiedAt: {
    type: Date,
    default: null,
  },
  lastStatusCheckedAt: {
    type: Date,
    default: null,
  },
  lastRequestId: {
    type: String,
    default: "",
    maxlength: 200,
  },
}, { timestamps: true });

CustomVoiceSchema.index({ userId: 1, updatedAt: -1 });
CustomVoiceSchema.index({ userId: 1, status: 1, updatedAt: -1 });
CustomVoiceSchema.index(
  { voiceId: 1 },
  {
    unique: true,
    partialFilterExpression: { voiceId: { $type: "string" } },
  }
);

export default mongoose.models.CustomVoice
  || mongoose.model("CustomVoice", CustomVoiceSchema);
