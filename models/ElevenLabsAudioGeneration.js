import crypto from "node:crypto";
import mongoose from "mongoose";
import { ELEVENLABS_AUDIO_MODEL, ELEVENLABS_AUDIO_TEXT_MAX_LENGTH } from "@/lib/media/shared/elevenlabsAudio";

const ElevenLabsAudioGenerationSchema = new mongoose.Schema({
  generationId: { type: String, required: true, unique: true, immutable: true, default: () => crypto.randomUUID() },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  model: { type: String, enum: [ELEVENLABS_AUDIO_MODEL], default: ELEVENLABS_AUDIO_MODEL, required: true },
  text: { type: String, required: true, maxlength: ELEVENLABS_AUDIO_TEXT_MAX_LENGTH },
  voiceId: { type: String, required: true, maxlength: 64 },
  voiceName: { type: String, required: true, maxlength: 200 },
  format: { type: String, enum: ["mp3", "wav"], required: true },
  sampleRate: { type: Number, enum: [16000, 22050, 24000, 44100, 48000], required: true },
  speed: { type: Number, min: 0.7, max: 1.2, required: true },
  stability: { type: Number, min: 0, max: 1, required: true },
  similarityBoost: { type: Number, min: 0, max: 1, required: true },
  style: { type: Number, min: 0, max: 1, required: true },
  useSpeakerBoost: { type: Boolean, required: true },
  characters: { type: Number, min: 0, required: true },
  bytes: { type: Number, min: 1, required: true },
  requestId: { type: String, default: "", maxlength: 200 },
  audioFileId: { type: String, required: true, index: true },
}, { timestamps: true });

ElevenLabsAudioGenerationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.ElevenLabsAudioGeneration
  || mongoose.model("ElevenLabsAudioGeneration", ElevenLabsAudioGenerationSchema);
