import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: ['backup', 'restore', 'inspect'], default: 'backup' },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true },
  selection: [String],
  destination: { connectionId: String, path: String },
  filename: String,
  error: String,
  counts: mongoose.Schema.Types.Mixed,
  completedAt: Date,
  scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'BackupSchedule' },
}, { timestamps: true });
schema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
export default mongoose.models.BackupJob || mongoose.model('BackupJob', schema);
