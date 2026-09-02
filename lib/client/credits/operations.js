export const CREDIT_OPERATION_HEADER = "X-Credit-Operation-Id";

export function createCreditOperationId() {
  return crypto.randomUUID();
}

export function creditOperationHeaders(operationId = createCreditOperationId()) {
  return {
    [CREDIT_OPERATION_HEADER]: operationId,
  };
}
