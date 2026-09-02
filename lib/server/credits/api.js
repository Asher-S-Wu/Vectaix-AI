import { CreditError } from "./errors";

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeCreditTransaction(transaction) {
  const reservedPoints = Number(transaction?.reserved) || 0;
  const chargedPoints = Number(transaction?.charged) || 0;
  const refundedPoints = Number(transaction?.refunded) || 0;
  let deltaPoints = -chargedPoints;
  if (["registration_grant", "admin_set"].includes(transaction?.type)) {
    const before = Number(transaction?.balanceBefore);
    const after = Number(transaction?.balanceAfter);
    deltaPoints = Number.isInteger(before) && Number.isInteger(after) ? after - before : 0;
  } else if (["pending", "reserved", "settling", "review_required"].includes(transaction?.status)) {
    deltaPoints = -reservedPoints;
  }
  return {
    id: transaction?._id?.toString?.() || transaction?.id || "",
    operationId: transaction?.operationId || "",
    type: transaction?.type || "",
    status: transaction?.status || "",
    feature: transaction?.feature || "",
    provider: transaction?.provider || "",
    model: transaction?.model || "",
    reservedPoints,
    chargedPoints,
    refundedPoints,
    deltaPoints,
    reason: transaction?.reason || "",
    createdAt: toIso(transaction?.createdAt),
    updatedAt: toIso(transaction?.updatedAt),
  };
}

export function billingResult(transaction, credit) {
  return {
    operationId: transaction?.operationId || "",
    status: transaction?.status || "",
    reservedPoints: Number(transaction?.reserved) || 0,
    chargedPoints: Number(transaction?.charged) || 0,
    refundedPoints: Number(transaction?.refunded) || 0,
    credit,
  };
}

export function creditErrorResponse(error, fallbackMessage = "积分处理失败") {
  const status = error instanceof CreditError ? error.statusCode : 500;
  const publicDetails = error instanceof CreditError && error.code === "INSUFFICIENT_CREDITS"
    ? {
        requiredPoints: Number(error.details?.required) || 0,
        availablePoints: Number(error.details?.available) || 0,
      }
    : null;
  return Response.json(
    {
      error: error instanceof CreditError ? error.message : fallbackMessage,
      code: error instanceof CreditError ? error.code : "CREDIT_INTERNAL_ERROR",
      ...(publicDetails ? { details: publicDetails } : {}),
    },
    { status },
  );
}

export function creditHeaders(summary) {
  return {
    "X-Credit-User": String(summary?.userId || ""),
    "X-Credit-Version": String(summary?.version ?? ""),
    "X-Credit-Available": String(summary?.availablePoints || 0),
    "X-Credit-Held": String(summary?.heldPoints || 0),
    "X-Credit-Unlimited": summary?.unlimited === true ? "true" : "false",
  };
}
