import { parseJsonRequest, requireUserRecord } from "@/lib/server/api/routeHelpers";
import mongoose from "mongoose";

export function workbenchError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function requireObjectId(id) {
  if (typeof id !== "string" || !mongoose.isValidObjectId(id)) throw workbenchError("记录不存在", 404);
  return id;
}

export async function readBody(req) {
  const parsed = await parseJsonRequest(req, "请求内容格式错误", 262144);
  if (!parsed.ok) throw workbenchError("请求内容格式错误或内容过大");
  if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) throw workbenchError("请求内容必须是对象");
  return parsed.body;
}

export function textField(value, label, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw workbenchError(`${label}${required ? "不能为空，且" : ""}最多 ${max} 个字`);
  }
  return value.trim();
}

export function booleanField(value, label) {
  if (typeof value !== "boolean") throw workbenchError(`${label}必须是开关值`);
  return value;
}

export async function workbenchRoute(req, handler) {
  try {
    const auth = await requireUserRecord({ request: req, connectDb: false });
    if (!auth) return Response.json({ error: "请先登录" }, { status: 401 });
    return await handler(String(auth.user._id));
  } catch (error) {
    const status = error.status || (error.name === "ValidationError" ? 400 : 500);
    if (status === 500) console.error("[Workbench] Request failed", error);
    return Response.json({ error: status === 500 ? "操作失败，请稍后再试" : error.message }, { status });
  }
}
