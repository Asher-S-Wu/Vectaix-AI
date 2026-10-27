import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, default: 'media' },
  image: { type: mongoose.Schema.Types.Mixed, default: {} },
  audio: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });

export default mongoose.models.MediaSettings || mongoose.model('MediaSettings', schema);
