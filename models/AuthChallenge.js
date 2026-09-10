import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  purpose: { type: String, enum: ['registration', 'authentication'], required: true },
  challenge: { type: String, required: true },
  name: String,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
export default mongoose.models.AuthChallenge || mongoose.model('AuthChallenge', schema);
