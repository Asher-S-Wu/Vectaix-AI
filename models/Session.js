import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
}, { timestamps: true });

SessionSchema.index({ userId: 1, expiresAt: 1 });

export default mongoose.models.Session || mongoose.model("Session", SessionSchema);
