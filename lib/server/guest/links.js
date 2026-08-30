import crypto from "node:crypto";
import GuestLink from "@/models/GuestLink";
import User from "@/models/User";
import { getGuestModel } from "@/lib/shared/guestModels";

const LINK_ID_PATTERN = /^[0-9a-f]{24}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class GuestAccessError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GuestAccessError";
    this.code = code;
    this.status = status;
  }
}

export function guestErrorResponse(error) {
  if (error instanceof GuestAccessError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[GuestLink] 请求失败", { errorType: error?.name, code: error?.code });
  return Response.json({ error: "操作失败，请稍后重试", code: "GUEST_REQUEST_FAILED" }, { status: 500 });
}

export function isGuestLinkId(value) {
  return typeof value === "string" && LINK_ID_PATTERN.test(value);
}

export function requireGuestLinkSecret() {
  const secret = process.env.GUEST_LINK_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new GuestAccessError("GUEST_LINK_SECRET_MISSING", "访问链接功能尚未配置", 503);
  }
  return secret;
}

function signGuestLink(link) {
  return crypto.createHmac("sha256", requireGuestLinkSecret())
    .update(`guest-link:v1:${link._id.toString()}:${link.revision}`)
    .digest("base64url");
}

export function buildGuestLinkUrl(link) {
  return `/guest/${link._id.toString()}#key=${signGuestLink(link)}`;
}

export function verifyGuestLinkKey(link, key) {
  const signature = signGuestLink(link);
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return false;
  return crypto.timingSafeEqual(Buffer.from(key, "ascii"), Buffer.from(signature, "ascii"));
}

export async function findActiveGuestLink(id) {
  if (!isGuestLinkId(id)) {
    throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 404);
  }
  const link = await GuestLink.findById(id).select("+revision").lean();
  if (!link) throw new GuestAccessError("GUEST_LINK_INVALID", "访问链接无效或已重置", 404);
  if (!link.enabled || link.deletionInProgress) {
    throw new GuestAccessError("GUEST_LINK_DISABLED", "此访问链接已停用", 403);
  }
  return link;
}

export function serializeGuestLink(link) {
  return {
    id: link._id.toString(),
    name: link.name,
    allowedModelIds: link.allowedModelIds,
    enabled: link.enabled,
    deletionInProgress: link.deletionInProgress === true,
    createdAt: link.createdAt,
  };
}

export function validateGuestLinkInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GuestAccessError("GUEST_LINK_INPUT_INVALID", "请求内容格式错误");
  }
  const result = {};
  if (!partial || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) {
      throw new GuestAccessError("GUEST_LINK_NAME_INVALID", "名称须为 1 至 80 个字符");
    }
    result.name = body.name.trim();
  }
  if (!partial || Object.hasOwn(body, "allowedModelIds")) {
    if (!Array.isArray(body.allowedModelIds) || body.allowedModelIds.length === 0
      || body.allowedModelIds.some((id) => typeof id !== "string" || !getGuestModel(id))) {
      throw new GuestAccessError("GUEST_LINK_MODELS_INVALID", "请至少选择一个有效模型");
    }
    result.allowedModelIds = [...new Set(body.allowedModelIds)];
  }
  if (Object.hasOwn(body, "enabled")) {
    if (typeof body.enabled !== "boolean") {
      throw new GuestAccessError("GUEST_LINK_INPUT_INVALID", "启用状态格式错误");
    }
    result.enabled = body.enabled;
  }
  if (partial && Object.keys(result).length === 0) {
    throw new GuestAccessError("GUEST_LINK_INPUT_INVALID", "没有可更新的内容");
  }
  return result;
}

export async function assertGuestUserIndexesReady() {
  const indexes = await User.collection.indexes();
  const email = indexes.find((index) => index.name === "member_email_unique");
  const guest = indexes.find((index) => index.name === "guest_link_user_unique");
  if (!email?.unique || email.key?.email !== 1
    || Object.keys(email.key).length !== 1
    || email.partialFilterExpression?.email?.$type !== "string"
    || Object.keys(email.partialFilterExpression).length !== 1
    || indexes.some((index) => index.name === "email_1")
    || !guest?.unique || guest.key?.guestLinkId !== 1
    || Object.keys(guest.key).length !== 1
    || guest.partialFilterExpression?.guestLinkId?.$type !== "objectId"
    || Object.keys(guest.partialFilterExpression).length !== 1) {
    throw new GuestAccessError("GUEST_USER_MIGRATION_REQUIRED", "请先完成游客账号索引迁移，再创建访问链接", 503);
  }
}
