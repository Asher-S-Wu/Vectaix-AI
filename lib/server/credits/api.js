import { CreditError } from "./errors";

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
