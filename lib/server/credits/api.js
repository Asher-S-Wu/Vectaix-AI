import { CreditError } from "./errors";

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeCreditTransaction(transaction) {
  return {
    id: transaction?._id?.toString?.() || transaction?.id || "",
    operationId: transaction?.operationId || "",
    type: transaction?.type || "",
    status: transaction?.status || "",
    feature: transaction?.feature || "",
    provider: transaction?.provider || "",
    model: transaction?.model || "",
    actualCostCny: transaction?.actualCostCny ?? null,
    actualCostUsd: transaction?.actualCostUsd ?? null,
    reason: transaction?.reason || "",
    createdAt: toIso(transaction?.createdAt),
    updatedAt: toIso(transaction?.updatedAt),
  };
}

export function billingResult(transaction) {
  return {
    operationId: transaction?.operationId || "",
    status: transaction?.status || "",
    actualCostCny: transaction?.actualCostCny ?? null,
    actualCostUsd: transaction?.actualCostUsd ?? null,
  };
}

export function creditErrorResponse(error, message = "花费记录处理失败") {
  const result = creditErrorResult(error, message);
  return Response.json(result.data, { status: result.status });
}

export function creditErrorResult(error, message = "花费记录处理失败") {
  return {
    data: {
      error: error instanceof CreditError ? error.message : message,
      code: error instanceof CreditError ? error.code : "CREDIT_INTERNAL_ERROR",
    },
    status: error instanceof CreditError ? error.statusCode : 500,
  };
}
