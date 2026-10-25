import mongoose from "mongoose";

const schema = new mongoose.Schema({
  slug: { type: String, required: true, maxlength: 100 },
  managed: { type: Boolean, default: true, required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: "", maxlength: 2000 },
  content: { type: String, required: true, maxlength: 200000 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  source: { type: { type: String, enum: ['github'], required: true }, url: { type: String, required: true }, importedAt: Date },
  revision: { type: String, required: true },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ slug: 1 }, { unique: true, partialFilterExpression: { managed: true } });

export default mongoose.models.WorkbenchSkill || mongoose.model("WorkbenchSkill", schema);
