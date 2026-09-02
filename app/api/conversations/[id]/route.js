import {
  deleteConversationForUser,
  getConversationForUser,
  isValidConversationId,
  updateConversationMessageTimeline,
  updateConversationForUser,
} from "@/lib/server/conversations/service";
import { TEXT_CHAT_MAX_REQUEST_BYTES } from '@/lib/server/chat/routeConstants';
import {
  assertRequestSize,
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";

async function requireConversationUser(req) {
  const auth = await requireUserRecord({ request: req, connectDb: true, select: null });
  return auth?.payload || null;
}

async function getRouteId(context) {
  const { id } = await context.params;
  return id;
}

export async function GET(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await requireConversationUser(req);
  if (!user) return unauthorizedResponse();

  const conversation = await getConversationForUser(id, user.userId);
  if (!conversation) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ conversation });
}

export async function DELETE(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await requireConversationUser(req);
  if (!user) return unauthorizedResponse();

  const conversation = await getConversationForUser(id, user.userId);
  if (!conversation) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await deleteConversationForUser(id, user.userId);
  return Response.json({ success: true });
}

export async function PUT(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const oversizeResponse = assertRequestSize(req, TEXT_CHAT_MAX_REQUEST_BYTES);
  if (oversizeResponse) return oversizeResponse;

  const user = await requireConversationUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req, "Invalid JSON", TEXT_CHAT_MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const conversation = await updateConversationForUser(id, user.userId, body);
    const nextConversation = conversation?.toObject?.() || conversation;
    if (!nextConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json({ conversation: nextConversation });
  } catch (error) {
    return Response.json({ error: error?.message || "更新失败" }, { status: 400 });
  }
}

export async function PATCH(req, context) {
  const id = await getRouteId(context);
  if (!isValidConversationId(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const oversizeResponse = assertRequestSize(req, TEXT_CHAT_MAX_REQUEST_BYTES);
  if (oversizeResponse) return oversizeResponse;

  const user = await requireConversationUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = await parseJsonRequest(req, "Invalid JSON", TEXT_CHAT_MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.keys(body).some((key) => !["messageId", "thinkingTimeline"].includes(key))
    || !Object.hasOwn(body, "messageId")
    || !Object.hasOwn(body, "thinkingTimeline")
  ) {
    return Response.json({ error: "Invalid message patch" }, { status: 400 });
  }

  try {
    const updated = await updateConversationMessageTimeline(id, user.userId, body);
    if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error?.message || "更新失败" }, { status: 400 });
  }
}
