import crypto from "node:crypto";
import { CreditError } from "@/lib/server/credits/errors";
import { getCreditOperation } from "@/lib/server/credits/service";

export const CREDIT_OPERATION_HEADER = "x-credit-operation-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEATURE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("幂等请求内容包含无效数字");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new TypeError("幂等请求内容包含不支持的值");
}

export function createMediaRequestFingerprint(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

export function requireMediaCreditOperation(request, {
  userId,
  feature,
  fingerprintInput,
} = {}) {
  const clientOperationId = String(request?.headers?.get?.(CREDIT_OPERATION_HEADER) || "").trim();
  if (!UUID_PATTERN.test(clientOperationId)) {
    throw new CreditError("缺少有效的媒体操作编号，请重新提交", {
      code: "CREDIT_OPERATION_ID_INVALID",
      statusCode: 400,
    });
  }
  if (typeof userId !== "string" || !userId || !FEATURE_PATTERN.test(feature || "")) {
    throw new TypeError("媒体积分操作命名参数无效");
  }
  return Object.freeze({
    clientOperationId: clientOperationId.toLowerCase(),
    operationId: `media:${feature}:${userId}:${clientOperationId.toLowerCase()}`,
    executionClaimId: crypto.randomUUID(),
    requestFingerprint: createMediaRequestFingerprint(fingerprintInput),
  });
}

export async function assertMediaCreditOperationUnused({
  operationId,
  userId,
  requestFingerprint,
} = {}) {
  const existing = await getCreditOperation({ operationId, userId, requestFingerprint });
  if (!existing) return;
  throw new CreditError(
    ["settled", "released", "rejected"].includes(existing.status)
      ? "本次媒体请求已经处理完成，请勿重复提交"
      : "本次媒体请求已在处理中，请勿重复提交",
    {
      code: ["settled", "released", "rejected"].includes(existing.status)
        ? "CREDIT_OPERATION_ALREADY_PROCESSED"
        : "CREDIT_OPERATION_ALREADY_CLAIMED",
      statusCode: 409,
      details: { status: existing.status },
    },
  );
}
