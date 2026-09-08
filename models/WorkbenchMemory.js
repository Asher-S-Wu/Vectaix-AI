import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkspaceProject", default: null },
  scope: { type: String, enum: ["personal", "project"], required: true },
  content: { type: String, required: true, trim: true, maxlength: 4000 },
  source: { type: String, enum: ["manual", "automatic"], default: "manual" },
}, { timestamps: true });
schema.index({ userId: 1, projectId: 1, updatedAt: -1 });

export default mongoose.models.WorkbenchMemory || mongoose.model("WorkbenchMemory", schema);
