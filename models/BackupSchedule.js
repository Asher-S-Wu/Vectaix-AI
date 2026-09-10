import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  enabled: { type: Boolean, default: true },
  frequency: { type: String, enum: ['daily', 'weekly'], required: true },
  hour: { type: Number, min: 0, max: 23, default: 2 },
  minute: { type: Number, min: 0, max: 59, default: 0 },
  weekday: { type: Number, min: 0, max: 6, default: 0 },
  timezone: { type: String, enum: ['Asia/Shanghai'], default: 'Asia/Shanghai' },
  selection: [String],
  destination: { connectionId: String, path: String },
  encryptedPassword: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  nextRunAt: { type: Date, required: true, index: true },
  lastRunAt: Date,
  lastError: String,
}, { timestamps: true });
export default mongoose.models.BackupSchedule || mongoose.model('BackupSchedule', schema);
