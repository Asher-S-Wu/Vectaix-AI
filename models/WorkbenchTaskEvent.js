import mongoose from "mongoose";
const schema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkbenchTask", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  seq: { type: Number, required: true },
  type: { type: String, required: true },
  message: { type: String, default: "" },
  data: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ taskId: 1, seq: 1 }, { unique: true });
export default mongoose.models.WorkbenchTaskEvent || mongoose.model("WorkbenchTaskEvent", schema);
