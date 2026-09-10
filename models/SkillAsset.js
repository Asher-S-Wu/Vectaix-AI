import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkbenchSkill', required: true, index: true },
  path: { type: String, required: true, maxlength: 500 },
  data: { type: Buffer, required: true },
  size: { type: Number, required: true },
  executable: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ userId: 1, skillId: 1, path: 1 }, { unique: true });
export default mongoose.models.SkillAsset || mongoose.model('SkillAsset', schema);
