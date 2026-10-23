import crypto from "node:crypto";
import mongoose from "mongoose";
import { FISH_AUDIO_MODEL, FISH_AUDIO_TEXT_MAX_LENGTH } from "@/lib/media/shared/fishAudio";

const FishAudioGenerationSchema = new mongoose.Schema({
  generationId: { type: String, required: true, unique: true, immutable: true, default: () => crypto.randomUUID() },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  model: { type: String, enum: [FISH_AUDIO_MODEL], default: FISH_AUDIO_MODEL, required: true },
  text: { type: String, required: true, maxlength: FISH_AUDIO_TEXT_MAX_LENGTH },
  voiceId: { type: String, required: true, maxlength: 32 },
  voiceName: { type: String, required: true, maxlength: 200 },
  format: { type: String, enum: ["mp3", "wav"], required: true },
  sampleRate: { type: Number, enum: [8000, 16000, 24000, 32000, 44100], required: true },
  speed: { type: Number, min: 0.5, max: 2, required: true },
  volume: { type: Number, min: -20, max: 20, required: true },
  temperature: { type: Number, min: 0, max: 1, required: true },
  topP: { type: Number, min: 0, max: 1, required: true },
  characters: { type: Number, min: 1, required: true },
  bytes: { type: Number, min: 1, required: true },
  requestId: { type: String, default: "", maxlength: 200 },
  audioFileId: { type: String, required: true, index: true },
}, { timestamps: true });

FishAudioGenerationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.FishAudioGeneration
  || mongoose.model("FishAudioGeneration", FishAudioGenerationSchema);
