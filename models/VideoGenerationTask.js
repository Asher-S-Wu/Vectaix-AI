import mongoose from "mongoose";

const VideoGenerationTaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  upstreamTaskId: { type: String, default: null, trim: true },
  status: {
    type: String,
    enum: ["queued", "in_progress", "finalizing", "completed", "failed", "canceled"],
    default: "queued",
    index: true,
  },
  model: {
    type: String,
    enum: [
      "happyhorse-1.1-t2v",
      "happyhorse-1.1-i2v",
      "happyhorse-1.1-r2v",
      "happyhorse-1.0-video-edit",
    ],
    required: true,
  },
  prompt: { type: String, default: "" },
  mode: {
    type: String,
    enum: ["text", "first-frame", "reference", "edit"],
    required: true,
    index: true,
  },
  inputFileIds: [{ type: String, trim: true }],
  params: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  error: { type: mongoose.Schema.Types.Mixed, default: null },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
  upstreamResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  videoFileId: { type: String, default: null },
  sourceAccessTokenHash: { type: String, default: null, select: false },
  sourceAccessTokenExpiresAt: { type: Date, default: null },
  sourceAccessRevokedAt: { type: Date, default: null },
  finalizationStartedAt: { type: Date, default: null },
  upstreamPolledAt: { type: Date, default: null },
  upstreamCreatedAt: { type: Date, default: null },
  upstreamUpdatedAt: { type: Date, default: null },
}, { timestamps: true, autoIndex: false });

VideoGenerationTaskSchema.index(
  { upstreamTaskId: 1 },
  {
    unique: true,
    partialFilterExpression: { upstreamTaskId: { $type: "string" } },
  },
);
VideoGenerationTaskSchema.index({ userId: 1, updatedAt: -1 });
VideoGenerationTaskSchema.index({ userId: 1, status: 1, updatedAt: -1 });

const VideoGenerationTask = mongoose.models.VideoGenerationTask
  || mongoose.model("VideoGenerationTask", VideoGenerationTaskSchema);

export async function ensureHappyHorseVideoTaskIndexes() {
  const collection = VideoGenerationTask.collection;
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (error?.code !== 26 && error?.codeName !== "NamespaceNotFound") throw error;
  }

  const upstreamIndex = indexes.find((index) => (
    Object.keys(index.key || {}).length === 1
    && index.key?.upstreamTaskId === 1
  ));
  const hasExpectedUpstreamIndex = Boolean(
    upstreamIndex?.unique
    && upstreamIndex?.partialFilterExpression?.upstreamTaskId?.$type === "string"
  );
  if (upstreamIndex && !hasExpectedUpstreamIndex) {
    try {
      await collection.dropIndex(upstreamIndex.name);
    } catch (error) {
      if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
    }
  }

  await collection.createIndex(
    { upstreamTaskId: 1 },
    {
      name: upstreamIndex?.name || "upstreamTaskId_1",
      unique: true,
      partialFilterExpression: { upstreamTaskId: { $type: "string" } },
    },
  );
  await collection.createIndex({ userId: 1 }, { name: "userId_1" });
  await collection.createIndex({ status: 1 }, { name: "status_1" });
  await collection.createIndex({ mode: 1 }, { name: "mode_1" });
  await collection.createIndex(
    { userId: 1, updatedAt: -1 },
    { name: "userId_1_updatedAt_-1" },
  );
  await collection.createIndex(
    { userId: 1, status: 1, updatedAt: -1 },
    { name: "userId_1_status_1_updatedAt_-1" },
  );
}

export default VideoGenerationTask;
