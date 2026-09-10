import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileFolder', default: null },
  name: { type: String, required: true, trim: true, maxlength: 200 },
}, { timestamps: true });
schema.index({ userId: 1, parentId: 1, name: 1 }, { unique: true });
export default mongoose.models.FileFolder || mongoose.model('FileFolder', schema);
