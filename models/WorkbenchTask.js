import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkspaceProject", default: null, index: true },
  requestId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
  userMessageId: { type: String, required: true },
  modelMessageId: { type: String, required: true },
  webSearch: { type: mongoose.Schema.Types.Mixed, default: { enabled: false } },
  chatSystemPrompt: { type: String, default: "" },
  thought: { type: String, default: "" },
  sourceConversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
  sourceContext: { type: String, default: "" },
  parentTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkbenchTask", default: null },
  prompt: { type: String, default: "", maxlength: 16000 },
  model: { type: String, required: true },
  mediaSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["queued", "running", "waiting_media", "waiting_approval", "completed", "failed", "stopped", "interrupted"], default: "queued", index: true },
  stopRequested: { type: Boolean, default: false },
  workerId: String,
  startedAt: Date,
  finishedAt: Date,
  output: { type: String, default: "" },
  error: { type: String, default: "" },
  summary: { type: String, default: "" },
  eventSeq: { type: Number, default: 0 },
  chargedPoints: { type: Number, default: 0 },
  billingReviewRequired: { type: Boolean, default: false },
  activeOperationId: { type: String, default: null },
  artifacts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  citations: { type: [mongoose.Schema.Types.Mixed], default: [] },
  mediaTasks: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });
schema.index({ userId: 1, requestId: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1, createdAt: -1 });
export default mongoose.models.WorkbenchTask || mongoose.model("WorkbenchTask", schema);
