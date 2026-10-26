import mongoose from 'mongoose';
import { QWEN_AUDIO_DEFAULTS } from '@/lib/media/shared/qwenAudio';

const schema = new mongoose.Schema({
  _id: { type: String, default: 'media' },
  image: { type: mongoose.Schema.Types.Mixed, default: {} },
  audio: { type: mongoose.Schema.Types.Mixed, default: {} },
  qwenAudio: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...QWEN_AUDIO_DEFAULTS }) },
  audioProvider: { type: String, enum: ['fish', 'qwen'], default: 'fish' },
}, { timestamps: true, minimize: false });

export default mongoose.models.MediaSettings || mongoose.model('MediaSettings', schema);
