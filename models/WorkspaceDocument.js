import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkspaceProject", default: null, index: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
  fileId: { type: String, required: true, unique: true },
  tables: { type: [mongoose.Schema.Types.Mixed], default: [] },
  chunks: [{ _id: false, locator: { type: String, required: true }, text: { type: String, required: true } }],
}, { timestamps: true });

export default mongoose.models.WorkspaceDocument || mongoose.model("WorkspaceDocument", schema);
