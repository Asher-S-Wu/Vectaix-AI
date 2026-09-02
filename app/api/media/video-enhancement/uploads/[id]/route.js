import mongoose from "mongoose";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { serializeMediaKitUploadTicket } from "@/lib/media/server/mediaKit/taskRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import MediaKitUploadTicket from "@/models/MediaKitUploadTicket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function safeErrorDetails(error) {
  const errorType = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
    ? error.name
    : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
    ? error.code
    : "INTERNAL_ERROR";
  return { errorType, code };
}

function getErrorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function getPublicErrorMessage(error, fallback) {
  return error?.name === "UserOperationLeaseError" ? error.message : fallback;
}

async function getTicketId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

async function loadOwnedTicket(id, userId) {
  return MediaKitUploadTicket.findOne({ _id: id, userId }).lean();
}

export async function PATCH(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const id = await getTicketId(context);
    if (!mongoose.isValidObjectId(id)) return jsonMessage("上传凭证编号无效", 400);
    if (request.body !== null) return jsonMessage("此请求不能包含请求内容", 400);

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const now = new Date();
    const ticket = await MediaKitUploadTicket.findOneAndUpdate(
      {
        _id: id,
        userId: user.userId,
        status: "issued",
        expiresAt: { $gt: now },
      },
      { $set: { status: "ready" } },
      { new: true },
    ).lean();
    if (ticket) {
      return Response.json({
        success: true,
        upload: serializeMediaKitUploadTicket(ticket),
      });
    }

    const existing = await loadOwnedTicket(id, user.userId);
    if (!existing) return jsonMessage("上传凭证不存在", 404);
    return jsonMessage(
      existing.expiresAt <= now ? "上传凭证已过期" : "上传凭证状态已变化",
      409,
    );
  } catch (error) {
    console.error("[AI MediaKit] confirm upload ticket failed", safeErrorDetails(error));
    return jsonMessage(getPublicErrorMessage(error, "确认视频上传失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[AI MediaKit] release upload confirmation lease failed", safeErrorDetails(error));
      });
    }
  }
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const id = await getTicketId(context);
    if (!mongoose.isValidObjectId(id)) return jsonMessage("上传凭证编号无效", 400);

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const ticket = await MediaKitUploadTicket.findOneAndUpdate(
      {
        _id: id,
        userId: user.userId,
        status: { $in: ["issued", "ready"] },
        consumedAt: null,
      },
      { $set: { status: "abandoned" } },
      { new: true },
    ).lean();
    if (ticket) return Response.json({ success: true, deleted: true });

    const existing = await loadOwnedTicket(id, user.userId);
    if (!existing) return jsonMessage("上传凭证不存在", 404);
    return jsonMessage("上传凭证已使用或已清除", 409);
  } catch (error) {
    console.error("[AI MediaKit] abandon upload ticket failed", safeErrorDetails(error));
    return jsonMessage(getPublicErrorMessage(error, "清除视频上传凭证失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[AI MediaKit] release upload deletion lease failed", safeErrorDetails(error));
      });
    }
  }
}
