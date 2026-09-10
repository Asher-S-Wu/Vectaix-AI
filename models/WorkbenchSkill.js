import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  builtinKey: { type: String },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: "", maxlength: 2000 },
  content: { type: String, required: true, maxlength: 200000 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  source: { type: { type: String, enum: ['manual', 'file', 'github'], default: 'manual' }, url: String, ref: String, directory: String, importedAt: Date },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ userId: 1, builtinKey: 1 }, { unique: true, partialFilterExpression: { builtinKey: { $type: "string" } } });

export default mongoose.models.WorkbenchSkill || mongoose.model("WorkbenchSkill", schema);
