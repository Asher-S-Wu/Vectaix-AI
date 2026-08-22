import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  DOUBAO_AUDIO_FORMAT_IDS,
  DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH,
  DOUBAO_AUDIO_LOUDNESS_RATE_MAX,
  DOUBAO_AUDIO_LOUDNESS_RATE_MIN,
  DOUBAO_AUDIO_MODEL,
  DOUBAO_AUDIO_PITCH_RATE_MAX,
  DOUBAO_AUDIO_PITCH_RATE_MIN,
  DOUBAO_AUDIO_SAMPLE_RATE_IDS,
  DOUBAO_AUDIO_SPEECH_RATE_MAX,
  DOUBAO_AUDIO_SPEECH_RATE_MIN,
  DOUBAO_AUDIO_TEXT_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DoubaoAudioGenerationSchema = new mongoose.Schema({
  generationId: {
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
  model: {
    type: String,
    enum: [DOUBAO_AUDIO_MODEL],
    default: DOUBAO_AUDIO_MODEL,
    required: true,
    immutable: true,
  },
  text: { type: String, required: true, maxlength: DOUBAO_AUDIO_TEXT_MAX_LENGTH },
  voiceId: { type: String, required: true, match: UUID_PATTERN, immutable: true },
  profileId: { type: String, required: true, match: UUID_PATTERN, immutable: true },
  voiceName: { type: String, required: true, maxlength: 100 },
  instruction: {
    type: String,
    default: "",
    maxlength: DOUBAO_AUDIO_INSTRUCTION_MAX_LENGTH,
  },
  format: { type: String, enum: DOUBAO_AUDIO_FORMAT_IDS, required: true },
  sampleRate: { type: Number, enum: DOUBAO_AUDIO_SAMPLE_RATE_IDS, required: true },
  speechRate: {
    type: Number,
    min: DOUBAO_AUDIO_SPEECH_RATE_MIN,
    max: DOUBAO_AUDIO_SPEECH_RATE_MAX,
    required: true,
  },
  loudnessRate: {
    type: Number,
    min: DOUBAO_AUDIO_LOUDNESS_RATE_MIN,
    max: DOUBAO_AUDIO_LOUDNESS_RATE_MAX,
    required: true,
  },
  pitchRate: {
    type: Number,
    min: DOUBAO_AUDIO_PITCH_RATE_MIN,
    max: DOUBAO_AUDIO_PITCH_RATE_MAX,
    required: true,
  },
  duration: { type: Number, min: 0.001, max: 120, required: true },
  originalDuration: { type: Number, min: 0.001, max: 120, required: true },
  requestId: { type: String, required: true, match: UUID_PATTERN, maxlength: 36 },
  upstreamLogId: { type: String, required: true, maxlength: 300 },
  referenceFileId: { type: String, required: true, index: true },
  audioFileId: { type: String, required: true, index: true },
}, { timestamps: true });

DoubaoAudioGenerationSchema.index({ userId: 1, model: 1, createdAt: -1 });

export default mongoose.models.DoubaoAudioGeneration
  || mongoose.model("DoubaoAudioGeneration", DoubaoAudioGenerationSchema);
