import mongoose from "mongoose";

export const CREDIT_TRANSACTION_TYPES = [
  "model_usage",
];

export const CREDIT_TRANSACTION_STATUSES = [
  "pending",
  "reserved",
  "settling",
  "settled",
  "released",
  "review_required",
  "rejected",
];

const CreditTransactionSchema = new mongoose.Schema({
  operationId: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  auditUserKey: {
    type: String,
    required: true,
    immutable: true,
  },
  actorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  type: {
    type: String,
    required: true,
    enum: CREDIT_TRANSACTION_TYPES,
  },
  feature: { type: String, default: "" },
  provider: { type: String, default: "" },
  model: { type: String, default: "" },
  status: {
    type: String,
    required: true,
    enum: CREDIT_TRANSACTION_STATUSES,
    default: "pending",
  },
  actualCostCny: { type: Number, min: 0, default: null },
  actualCostUsd: { type: Number, min: 0, default: null },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
  pricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  upstreamRequestIds: { type: [String], default: [] },
  reservationRequestHash: { type: String, trim: true, maxlength: 64 },
  executionClaimId: { type: String, trim: true, maxlength: 200 },
  claimedAt: { type: Date },
  reason: { type: String, default: "" },
}, {
  autoIndex: false,
  timestamps: true,
});

CreditTransactionSchema.index(
  { operationId: 1 },
  { name: "credit_transaction_operation_unique", unique: true },
);
CreditTransactionSchema.index(
  { userId: 1, createdAt: -1 },
  { name: "credit_transaction_user_created" },
);
CreditTransactionSchema.index(
  { status: 1, createdAt: 1 },
  { name: "credit_transaction_status_created" },
);
CreditTransactionSchema.index(
  { executionClaimId: 1 },
  { name: "credit_transaction_execution_claim_unique", unique: true, sparse: true },
);

const CreditTransaction = mongoose.models.CreditTransaction
  || mongoose.model("CreditTransaction", CreditTransactionSchema);

export async function ensureCreditTransactionIndexes() {
  await CreditTransaction.createIndexes();
}

export default CreditTransaction;
