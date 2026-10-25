import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkbenchSkill', required: true, index: true },
  revision: { type: String, required: true },
  path: { type: String, required: true, maxlength: 500 },
  data: { type: Buffer, required: true },
  size: { type: Number, required: true },
  executable: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ skillId: 1, revision: 1, path: 1 }, { unique: true });
export default mongoose.models.SkillAsset || mongoose.model('SkillAsset', schema);
