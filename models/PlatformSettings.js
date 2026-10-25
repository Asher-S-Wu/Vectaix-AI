import mongoose from 'mongoose';

const PlatformSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'platform' },
  modelConfig: { type: mongoose.Schema.Types.Mixed, default: null },
  sandboxConfig: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, minimize: false });

export default mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', PlatformSettingsSchema);
