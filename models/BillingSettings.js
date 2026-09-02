import mongoose from "mongoose";

const BillingSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    enum: ["default"],
  },
  version: {
    type: Number,
    required: true,
    min: 1,
    validate: Number.isSafeInteger,
  },
  initialCredits: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  },
  costMultiplier: {
    type: Number,
    required: true,
    validate: (value) => Number.isFinite(value) && value > 0,
  },
  usdToCny: {
    type: Number,
    required: true,
    validate: (value) => Number.isFinite(value) && value > 0,
  },
  chatReservationLimit: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  },
  pricingDate: {
    type: String,
    required: true,
  },
  rates: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  updatedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, { autoIndex: false });

BillingSettingsSchema.index({ key: 1 }, { name: "billing_settings_key_unique", unique: true });

const BillingSettings = mongoose.models.BillingSettings
  || mongoose.model("BillingSettings", BillingSettingsSchema);

export async function ensureBillingSettingsIndexes() {
  await BillingSettings.createIndexes();
}

export default BillingSettings;
