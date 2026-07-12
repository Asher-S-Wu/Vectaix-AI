import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  id: { type: String },
  role: { type: String, required: true }, // 'user' or 'model'
  content: { type: String, default: '' },
  thought: { type: String }, // For model thinking blocks
  thinkingTimeline: { type: [mongoose.Schema.Types.Mixed] }, // 联网搜索流程时间线
  citations: { type: [mongoose.Schema.Types.Mixed] },
  tools: { type: [mongoose.Schema.Types.Mixed] },
  providerState: { type: mongoose.Schema.Types.Mixed },
  type: { type: String, default: 'text', enum: ['text', 'parts', 'error'] },
  // Gemini multi-turn image editing: persist sanitized content.parts with thoughtSignature
  // - text parts: { text, thought?, thoughtSignature? }
  // - image parts: { inlineData: { fileId, mimeType, url }, thoughtSignature? }
  parts: { type: [mongoose.Schema.Types.Mixed] },
  fusionExperts: { type: [mongoose.Schema.Types.Mixed] },
  fusionAnalysis: { type: mongoose.Schema.Types.Mixed },
  searchContextTokens: { type: Number },
  createdAt: { type: Date, default: Date.now }
});

const ConversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    default: 'New Chat',
  },
  model: {
    type: String,
    default: null,
  },
  // 对话专属设置
  settings: {
    webSearch: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  pinned: {
    type: Boolean,
    default: false,
  },
  messages: [MessageSchema],
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
