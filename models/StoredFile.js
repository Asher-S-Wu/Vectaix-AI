import mongoose from "mongoose";

const StoredFileSchema = new mongoose.Schema({
  fileId: {
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
  storageKey: {
    type: String,
    required: true,
    unique: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    required: true,
    min: 1,
  },
  extension: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    enum: ["image", "video", "audio"],
    required: true,
  },
  kind: {
    type: String,
    enum: ["chat", "avatar", "media-image", "media-video", "media-audio", "voice-sample"],
    required: true,
  },
  ownerType: {
    type: String,
    enum: [
      "temporary",
      "conversation",
      "avatar",
      "image-result",
      "video-task",
      "audio-generation",
      "voice-profile",
    ],
    default: "temporary",
    index: true,
  },
  ownerId: {
    type: String,
    default: null,
    index: true,
  },
}, { timestamps: true });

StoredFileSchema.index({ userId: 1, ownerType: 1, createdAt: 1 });
StoredFileSchema.index({ userId: 1, ownerType: 1, ownerId: 1 });

export default mongoose.models.StoredFile || mongoose.model("StoredFile", StoredFileSchema);
