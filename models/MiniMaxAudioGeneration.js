import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  MINIMAX_AUDIO_BITRATES, MINIMAX_AUDIO_EMOTIONS, MINIMAX_AUDIO_FORMATS, MINIMAX_AUDIO_MODEL, MINIMAX_AUDIO_SAMPLE_RATES,
  MINIMAX_AUDIO_TEXT_MAX_LENGTH, MINIMAX_LANGUAGE_BOOSTS, MINIMAX_SOUND_EFFECTS, MINIMAX_TEXT_NORMALIZATION_MODES,
} from "@/lib/media/shared/minimaxAudio";

const MiniMaxAudioGenerationSchema = new mongoose.Schema({
  generationId: { type: String, required: true, unique: true, immutable: true, default: () => crypto.randomUUID() },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  model: { type: String, enum: [MINIMAX_AUDIO_MODEL], default: MINIMAX_AUDIO_MODEL, required: true },
  text: { type: String, required: true, maxlength: MINIMAX_AUDIO_TEXT_MAX_LENGTH },
  voiceId: { type: String, required: true, maxlength: 256 },
  voiceName: { type: String, required: true, maxlength: 200 },
  format: { type: String, enum: [...MINIMAX_AUDIO_FORMATS], required: true },
  sampleRate: { type: Number, enum: [...MINIMAX_AUDIO_SAMPLE_RATES], required: true },
  bitrate: { type: Number, enum: [...MINIMAX_AUDIO_BITRATES], required: true },
  speed: { type: Number, min: 0.5, max: 2, required: true },
  volume: { type: Number, min: 0.1, max: 10, required: true },
  pitch: { type: Number, min: -12, max: 12, required: true },
  emotion: { type: String, enum: [...MINIMAX_AUDIO_EMOTIONS], required: true },
  languageBoost: { type: String, enum: Object.keys(MINIMAX_LANGUAGE_BOOSTS), required: true },
  soundEffect: { type: String, enum: [...MINIMAX_SOUND_EFFECTS], required: true },
  textNormalization: { type: String, enum: [...MINIMAX_TEXT_NORMALIZATION_MODES], required: true },
  characters: { type: Number, min: 0, required: true },
  bytes: { type: Number, min: 1, required: true },
  requestId: { type: String, default: "", maxlength: 200 },
  audioFileId: { type: String, required: true, index: true },
}, { timestamps: true });

MiniMaxAudioGenerationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.MiniMaxAudioGeneration
  || mongoose.model("MiniMaxAudioGeneration", MiniMaxAudioGenerationSchema);
