export class CreditError extends Error {
  constructor(message, { code = "CREDIT_ERROR", statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "CreditError";
    this.code = code;
    this.statusCode = statusCode;
    this.status = statusCode;
    this.details = details;
  }
}

export class InsufficientCreditsError extends CreditError {
  constructor(details = null) {
    super("积分余额不足", {
      code: "INSUFFICIENT_CREDITS",
      statusCode: 402,
      details,
    });
    this.name = "InsufficientCreditsError";
  }
}

export function invalidCreditArgument(message, details = null) {
  return new CreditError(message, {
    code: "INVALID_CREDIT_ARGUMENT",
    statusCode: 400,
    details,
  });
}
