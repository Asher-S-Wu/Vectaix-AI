import mongoose from "mongoose";
import { normalizeFileId } from "@/lib/shared/fileIds";
import {
  VIDEO_ENHANCEMENT_BITRATE_MODES,
  VIDEO_ENHANCEMENT_BITRATE_LEVELS,
  VIDEO_ENHANCEMENT_ERROR_CODES,
  VIDEO_ENHANCEMENT_MODEL,
  VIDEO_ENHANCEMENT_RESOLUTIONS,
  VIDEO_ENHANCEMENT_RESULT_MAX_BYTES,
  VIDEO_ENHANCEMENT_SOURCE_TYPES,
  VIDEO_ENHANCEMENT_TASK_STATUSES,
  normalizeVideoEnhancementError,
} from "@/lib/media/shared/videoEnhancement";

const BitrateSchema = new mongoose.Schema({
  mode: { type: String, enum: VIDEO_ENHANCEMENT_BITRATE_MODES, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { _id: false, strict: "throw" });

BitrateSchema.pre("validate", function validateBitrate() {
  if (this.mode === "level" && !VIDEO_ENHANCEMENT_BITRATE_LEVELS.includes(this.value)) {
    this.invalidate("value", "不支持的码率档位");
  }
  if (
    this.mode === "exact"
    && (!Number.isInteger(this.value) || this.value < 10 || this.value > 150000)
  ) {
    this.invalidate("value", "精确码率必须是 10 到 150000 之间的整数");
  }
});

const SettingsSchema = new mongoose.Schema({
  resolution: { type: String, enum: VIDEO_ENHANCEMENT_RESOLUTIONS, required: true },
  fps: {
    type: Number,
    min: 15,
    max: 120,
    default: null,
    validate: {
      validator(value) {
        return value === null || Number.isInteger(value);
      },
      message: "目标帧率必须是整数",
    },
  },
  bitrate: { type: BitrateSchema, required: true },
}, { _id: false, strict: "throw" });

const LeaseSchema = new mongoose.Schema({
  owner: { type: String, required: true, minlength: 1, maxlength: 128, select: false },
  expiresAt: { type: Date, required: true },
}, { _id: false, strict: "throw" });

const ResultSchema = new mongoose.Schema({
  size: {
    type: Number,
    required: true,
    min: 1,
    max: VIDEO_ENHANCEMENT_RESULT_MAX_BYTES,
    validate: Number.isInteger,
  },
  duration: { type: Number, min: 0, required: true },
  resolution: { type: String, enum: VIDEO_ENHANCEMENT_RESOLUTIONS, required: true },
  fps: { type: Number, min: 1, max: 120, required: true },
}, { _id: false, strict: "throw" });

const ErrorSchema = new mongoose.Schema({
  code: { type: String, enum: VIDEO_ENHANCEMENT_ERROR_CODES, required: true },
}, { _id: false, strict: "throw" });

const VideoEnhancementTaskSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
    immutable: true,
  },
  model: {
    type: String,
    enum: [VIDEO_ENHANCEMENT_MODEL],
    default: VIDEO_ENHANCEMENT_MODEL,
    required: true,
    immutable: true,
  },
  sourceType: {
    type: String,
    enum: VIDEO_ENHANCEMENT_SOURCE_TYPES,
    required: true,
    immutable: true,
    index: true,
  },
  sourceName: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 180,
    immutable: true,
    validate: {
      validator(value) {
        return !/:\/\/|[\\/?#\u0000-\u001f\u007f]/.test(value);
      },
      message: "视频来源名称不符合要求",
    },
  },
  sourceHost: {
    type: String,
    lowercase: true,
    trim: true,
    maxlength: 253,
    default: null,
    immutable: true,
    validate: {
      validator(value) {
        return value === null || (
          !/[:\\/?#@\u0000-\u001f\u007f]/.test(value)
          && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
          && value !== "localhost"
          && !value.endsWith(".localhost")
          && /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value)
        );
      },
      message: "视频来源域名不符合要求",
    },
  },
  sourceDurationSeconds: {
    type: Number,
    required: true,
    min: 1,
    max: 60,
    immutable: true,
  },
  sourceDurationVerified: {
    type: Boolean,
    required: true,
    default: false,
    immutable: true,
  },
  settings: { type: SettingsSchema, required: true, immutable: true },
  clientToken: {
    type: String,
    required: true,
    unique: true,
    index: true,
    immutable: true,
    select: false,
    minlength: 1,
    maxlength: 64,
    validate: {
      validator(value) {
        return /^[\x20-\x7e]+$/.test(value);
      },
      message: "客户端任务凭证必须是 64 字符以内的可打印 ASCII 文本",
    },
  },
  upstreamTaskId: {
    type: String,
    trim: true,
    minlength: 8,
    maxlength: 256,
    default: null,
    select: false,
  },
  status: {
    type: String,
    enum: VIDEO_ENHANCEMENT_TASK_STATUSES,
    default: "submitting",
    required: true,
    index: true,
  },
  nextPollAt: { type: Date, default: null, index: true },
  lease: { type: LeaseSchema, default: null },
  upstreamCreatedAt: { type: Date, default: null },
  lastSyncedAt: { type: Date, default: null },
  finalizationStartedAt: { type: Date, default: null },
  submissionDispatchedAt: { type: Date, default: null },
  deletionRequestedAt: { type: Date, default: null, select: false },
  videoFileId: {
    type: String,
    trim: true,
    lowercase: true,
    minlength: 36,
    maxlength: 36,
    default: null,
    index: true,
    validate: {
      validator(value) {
        return value === null || normalizeFileId(value) === value;
      },
      message: "视频结果文件标识格式不正确",
    },
  },
  result: { type: ResultSchema, default: null },
  billing: { type: mongoose.Schema.Types.Mixed, default: null },
  billingPricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  error: { type: ErrorSchema, default: null },
}, {
  timestamps: true,
  strict: "throw",
  autoIndex: false,
});

VideoEnhancementTaskSchema.pre("validate", function validateTask() {
  if (this.sourceType === "url" && !this.sourceHost) {
    this.invalidate("sourceHost", "公网视频来源必须记录域名");
  }
  if (this.sourceType === "upload" && this.sourceHost) {
    this.invalidate("sourceHost", "本地上传来源不能记录公网域名");
  }
  if (this.status === "completed" && (!this.videoFileId || !this.result)) {
    this.invalidate("result", "已完成的任务必须关联保存后的结果文件和元数据");
  }
  if (this.status !== "completed" && (this.videoFileId || this.result)) {
    this.invalidate("result", "未完成的任务不能关联结果文件或元数据");
  }
  if (this.status === "failed" && !this.error) {
    this.invalidate("error", "失败的任务必须记录安全错误信息");
  }
  if (!["failed", "canceled"].includes(this.status) && this.error) {
    this.invalidate("error", "非失败任务不能记录错误信息");
  }
  if (this.error) {
    const safeError = normalizeVideoEnhancementError(this.error);
    this.error.code = safeError.code;
  }
  if (
    this.deletionRequestedAt
    && !["completed", "failed", "canceled"].includes(this.status)
  ) {
    this.invalidate("deletionRequestedAt", "只有已结束的任务可以登记删除意图");
  }
});

VideoEnhancementTaskSchema.index(
  { upstreamTaskId: 1 },
  {
    unique: true,
    partialFilterExpression: { upstreamTaskId: { $type: "string" } },
  },
);
VideoEnhancementTaskSchema.index({ userId: 1, deletionRequestedAt: 1, updatedAt: -1 });
VideoEnhancementTaskSchema.index({ userId: 1, status: 1, updatedAt: -1 });
VideoEnhancementTaskSchema.index({
  status: 1,
  deletionRequestedAt: 1,
  nextPollAt: 1,
  "lease.expiresAt": 1,
});
VideoEnhancementTaskSchema.index({
  status: 1,
  deletionRequestedAt: 1,
  upstreamTaskId: 1,
  createdAt: 1,
  "lease.expiresAt": 1,
});
VideoEnhancementTaskSchema.index(
  { deletionRequestedAt: 1, _id: 1 },
  { partialFilterExpression: { deletionRequestedAt: { $type: "date" } } },
);

const VideoEnhancementTask = mongoose.models.VideoEnhancementTask
  || mongoose.model("VideoEnhancementTask", VideoEnhancementTaskSchema);

export async function ensureVideoEnhancementTaskIndexes() {
  const collection = VideoEnhancementTask.collection;
  await collection.createIndex({ userId: 1 }, { name: "userId_1" });
  await collection.createIndex({ sourceType: 1 }, { name: "sourceType_1" });
  await collection.createIndex({ clientToken: 1 }, { name: "clientToken_1", unique: true });
  await collection.createIndex({ status: 1 }, { name: "status_1" });
  await collection.createIndex({ nextPollAt: 1 }, { name: "nextPollAt_1" });
  await collection.createIndex({ videoFileId: 1 }, { name: "videoFileId_1" });
  await collection.createIndex(
    { upstreamTaskId: 1 },
    {
      name: "upstreamTaskId_1",
      unique: true,
      partialFilterExpression: { upstreamTaskId: { $type: "string" } },
    },
  );
  await collection.createIndex(
    { userId: 1, deletionRequestedAt: 1, updatedAt: -1 },
    { name: "userId_1_deletionRequestedAt_1_updatedAt_-1" },
  );
  await collection.createIndex(
    { userId: 1, status: 1, updatedAt: -1 },
    { name: "userId_1_status_1_updatedAt_-1" },
  );
  await collection.createIndex(
    { status: 1, deletionRequestedAt: 1, nextPollAt: 1, "lease.expiresAt": 1 },
    { name: "status_1_deletionRequestedAt_1_nextPollAt_1_lease.expiresAt_1" },
  );
  await collection.createIndex(
    {
      status: 1,
      deletionRequestedAt: 1,
      upstreamTaskId: 1,
      createdAt: 1,
      "lease.expiresAt": 1,
    },
    {
      name: "status_1_deletionRequestedAt_1_upstreamTaskId_1_createdAt_1_lease.expiresAt_1",
    },
  );
  await collection.createIndex(
    { deletionRequestedAt: 1, _id: 1 },
    {
      name: "deletionRequestedAt_1__id_1",
      partialFilterExpression: { deletionRequestedAt: { $type: "date" } },
    },
  );
}

export default VideoEnhancementTask;
