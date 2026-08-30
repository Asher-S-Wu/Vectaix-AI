import crypto from "node:crypto";
import mongoose from "mongoose";
import { getGuestModel } from "@/lib/shared/guestModels";

const GuestLinkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  allowedModelIds: {
    type: [String],
    required: true,
    validate: {
      validator: (ids) => ids.length > 0 && ids.every((id) => Boolean(getGuestModel(id))),
      message: "请至少选择一个有效模型",
    },
  },
  enabled: { type: Boolean, default: true, required: true },
  revision: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(32).toString("base64url"),
    select: false,
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  deletionInProgress: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.models.GuestLink || mongoose.model("GuestLink", GuestLinkSchema);
