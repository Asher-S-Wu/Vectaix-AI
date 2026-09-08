import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: "", maxlength: 2000 },
  instructions: { type: String, default: "", maxlength: 20000 },
  memoryEnabled: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.models.WorkspaceProject || mongoose.model("WorkspaceProject", schema);
