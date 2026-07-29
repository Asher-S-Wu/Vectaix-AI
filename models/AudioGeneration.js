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

const AudioGenerationSchema = new mongoose.Schema({
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
    enum: [AUDIO_MODEL],
    default: AUDIO_MODEL,
    required: true,
  },
  text: {
    type: String,
    required: true,
    maxlength: 32000,
  },
  voiceId: {
    type: String,
    required: true,
    maxlength: 200,
  },
  voiceName: {
    type: String,
    required: true,
    maxlength: 100,
  },
  instruction: {
    type: String,
    default: "",
    maxlength: 1000,
  },
  format: {
    type: String,
    enum: ["mp3", "wav"],
    required: true,
  },
  sampleRate: {
    type: Number,
    enum: [16000, 24000, 48000],
    required: true,
  },
  rate: {
    type: Number,
    min: 0.5,
    max: 2,
    required: true,
  },
  pitch: {
    type: Number,
    min: 0.5,
    max: 2,
    required: true,
  },
  volume: {
    type: Number,
    min: 0,
    max: 100,
    required: true,
  },
  languageHint: {
    type: String,
    enum: LANGUAGE_HINTS,
    default: null,
    set: (value) => {
      const normalized = String(value || "").trim();
      return normalized || null;
    },
  },
  characters: {
    type: Number,
    min: 0,
    required: true,
  },
  requestId: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  audioFileId: {
    type: String,
    required: true,
    index: true,
  },
}, { timestamps: true });

AudioGenerationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.AudioGeneration
  || mongoose.model("AudioGeneration", AudioGenerationSchema);
