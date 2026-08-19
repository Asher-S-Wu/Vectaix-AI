import mongoose from "mongoose";
import {
  VIDEO_ENHANCEMENT_INPUT_EXTENSIONS,
  VIDEO_ENHANCEMENT_INPUT_MIME_TYPES,
  VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION,
  VIDEO_ENHANCEMENT_UPLOAD_MAX_BYTES,
  VIDEO_ENHANCEMENT_UPLOAD_TICKET_TTL_MS,
} from "@/lib/media/shared/videoEnhancement";

const UPLOAD_TICKET_EXPIRY_CLOCK_SKEW_MS = 60 * 1000;

const MediaKitUploadTicketSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
    immutable: true,
  },
  providerFileId: {
    type: String,
    required: true,
    trim: true,
    minlength: 12,
    maxlength: 4096,
    select: false,
    immutable: true,
    validate: {
      validator(value) {
        return /^mediakit:\/\/[A-Za-z0-9_-]+$/.test(value);
      },
      message: "MediaKit 文件标识格式不正确",
    },
  },
  status: {
    type: String,
    enum: ["issued", "ready", "consumed", "abandoned"],
    default: "issued",
    required: true,
    index: true,
  },
  safeOriginalName: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 180,
    immutable: true,
    validate: {
      validator(value) {
        return !/[<>:"|?*#\\/\u0000-\u001f\u007f]/.test(value)
          && value !== "."
          && value !== "..";
      },
      message: "视频文件名不符合要求",
    },
  },
  size: {
    type: Number,
    required: true,
    min: 1,
    max: VIDEO_ENHANCEMENT_UPLOAD_MAX_BYTES,
    immutable: true,
    validate: Number.isInteger,
  },
  mimeType: {
    type: String,
    enum: VIDEO_ENHANCEMENT_INPUT_MIME_TYPES,
    required: true,
    immutable: true,
  },
  extension: {
    type: String,
    enum: VIDEO_ENHANCEMENT_INPUT_EXTENSIONS,
    required: true,
    immutable: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    immutable: true,
    validate: {
      validator(value) {
        if (!this.isNew) return true;
        const remainingMs = value?.getTime() - Date.now();
        return Number.isFinite(remainingMs)
          && remainingMs >= VIDEO_ENHANCEMENT_UPLOAD_TICKET_TTL_MS
            - UPLOAD_TICKET_EXPIRY_CLOCK_SKEW_MS
          && remainingMs <= VIDEO_ENHANCEMENT_UPLOAD_TICKET_TTL_MS
            + UPLOAD_TICKET_EXPIRY_CLOCK_SKEW_MS;
      },
      message: "MediaKit 上传凭证有效期必须为 24 小时",
    },
  },
  consumedAt: { type: Date, default: null },
}, {
  timestamps: true,
  strict: "throw",
});

MediaKitUploadTicketSchema.pre("validate", function validateTicketState() {
  if (
    typeof this.safeOriginalName === "string"
    && typeof this.extension === "string"
    && !this.safeOriginalName.toLowerCase().endsWith(`.${this.extension}`)
  ) {
    this.invalidate("extension", "视频文件扩展名与文件名不一致");
  }
  if (
    typeof this.extension === "string"
    && typeof this.mimeType === "string"
    && !VIDEO_ENHANCEMENT_INPUT_MIME_TYPES_BY_EXTENSION[this.extension]?.includes(this.mimeType)
  ) {
    this.invalidate("mimeType", "视频文件扩展名与文件类型不匹配");
  }
  if (this.status === "consumed" && !this.consumedAt) {
    this.invalidate("consumedAt", "已使用的上传凭证必须记录使用时间");
  }
  if (this.status !== "consumed" && this.consumedAt) {
    this.invalidate("consumedAt", "未使用的上传凭证不能记录使用时间");
  }
});

MediaKitUploadTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
MediaKitUploadTicketSchema.index({ userId: 1, status: 1, expiresAt: 1 });

export default mongoose.models.MediaKitUploadTicket
  || mongoose.model("MediaKitUploadTicket", MediaKitUploadTicketSchema);
