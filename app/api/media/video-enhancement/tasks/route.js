import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { calculateMediaKitCost } from "@/lib/server/credits/pricing";
import {
  getCreditSummary,
  releaseCreditExecutionClaim,
} from "@/lib/server/credits/service";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
} from "@/lib/media/server/billing";
import {
  assertMediaCreditOperationUnused,
  requireMediaCreditOperation,
} from "@/lib/media/server/creditOperation";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  VIDEO_ENHANCEMENT_MODEL,
  normalizeVideoEnhancementCreateInput,
  normalizeVideoEnhancementError,
} from "@/lib/media/shared/videoEnhancement";
import {
  MediaKitError,
  createMediaKitClientToken,
  submitMediaKitVideoEnhancementTask,
} from "@/lib/media/server/mediaKit/client";
import {
  MediaKitSecurityError,
  assertPublicHttpsMediaUrl,
} from "@/lib/media/server/mediaKit/security";
import {
  finalizeMediaKitTaskBilling,
  serializeVideoEnhancementTask,
} from "@/lib/media/server/mediaKit/taskRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import MediaKitUploadTicket from "@/models/MediaKitUploadTicket";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JSON_BYTES = 32 * 1024;
const TASK_SUBMISSION_TIMEOUT_MS = 2 * 60 * 1000;
const NEXT_POLL_DELAY_MS = 30 * 1000;
const USER_RATE_LIMIT = Object.freeze({ limit: 6, windowMs: 60 * 1000 });
const IP_RATE_LIMIT = Object.freeze({ limit: 18, windowMs: 60 * 1000 });
const PUBLIC_TASK_FIELDS = [
  "_id",
  "model",
  "status",
  "sourceType",
  "sourceName",
  "sourceHost",
  "sourceDurationSeconds",
  "sourceDurationVerified",
  "settings",
  "videoFileId",
  "result",
  "error",
  "billing",
  "createdAt",
  "updatedAt",
  "lastSyncedAt",
].join(" ");

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

function getErrorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function getPublicErrorMessage(error, fallback) {
  if (
    error instanceof MediaKitError
    || error instanceof MediaKitSecurityError
    || error?.name === "UserOperationLeaseError"
  ) {
    return error.message;
  }
  return fallback;
}

function isRateLimited(request, userId) {
  const ip = getClientIP(request);
  const userLimit = rateLimit(`media-video-enhancement-task:user:${userId}`, USER_RATE_LIMIT);
  const ipLimit = rateLimit(`media-video-enhancement-task:ip:${ip}`, IP_RATE_LIMIT);
  return !userLimit.success || !ipLimit.success;
}

function createPublicSourceName(url) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith("/")) return "公网视频";
  const encodedName = pathname.split("/").pop();
  if (!encodedName) return "公网视频";
  const decodedName = decodeURIComponent(encodedName);
  let safeName = decodedName
    .replace(/[<>:"|?*#\\/\u0000-\u001f\u007f]/g, "_")
    .trim();
  if (!safeName || safeName === "." || safeName === "..") return "公网视频";
  safeName = safeName.slice(0, 180);
  if (/[\ud800-\udbff]$/.test(safeName)) safeName = safeName.slice(0, -1);
  return safeName || "公网视频";
}

function assertSafeSourceHost(hostname) {
  if (!/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(hostname)) {
    throw new MediaKitSecurityError();
  }
}

function normalizeSubmissionFailure(error) {
  let code = "TASK_FAILED";
  if (error instanceof MediaKitError || error instanceof MediaKitSecurityError) {
    code = error.code;
  }
  const safe = normalizeVideoEnhancementError({ code });
  return {
    code: safe.code,
    message: safe.message,
    status: safe.code === "TASK_CANCELED" ? "canceled" : "failed",
  };
}

function isAmbiguousSubmissionError(error) {
  return [
    "UPSTREAM_TIMEOUT",
    "UPSTREAM_NETWORK_ERROR",
    "INVALID_UPSTREAM_RESPONSE",
    "UPSTREAM_INTERNAL_ERROR",
    "UPSTREAM_UNAVAILABLE",
  ].includes(String(error?.code || ""));
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const tasks = await VideoEnhancementTask.find({
      userId: user.userId,
      deletionRequestedAt: null,
    })
      .select(PUBLIC_TASK_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    const credit = await getCreditSummary(user.userId);
    return Response.json({
      success: true,
      tasks: tasks.map(serializeVideoEnhancementTask).filter(Boolean),
      credit,
    });
  } catch (error) {
    console.error("[AI MediaKit] list enhancement tasks failed", safeErrorDetails(error));
    return jsonMessage("读取视频画质增强任务失败", 500);
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  let task = null;
  let userId = "";
  let operationId = "";
  let reservation = null;
  let submissionStarted = false;
  let requestDispatched = false;
  let upstreamTaskId = "";
  let upstreamTaskCreatedAt = null;
  let billingFinalized = false;
  let responseBilling = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    userId = user.userId;
    if (isRateLimited(request, user.userId)) {
      return jsonMessage("视频画质增强请求过于频繁，请稍后再试", 429);
    }

    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) {
      return jsonMessage(
        parsed.response.status === 413 ? "请求内容过大" : "请求内容格式错误",
        parsed.response.status,
      );
    }
    let input;
    try {
      input = normalizeVideoEnhancementCreateInput(parsed.body);
    } catch {
      return jsonMessage("视频画质增强参数不符合要求", 400);
    }
    if (!Number.isFinite(input.sourceDurationSeconds)) {
      return jsonMessage("请填写 1 到 60 秒之间的视频时长", 400);
    }

    const creditOperation = requireMediaCreditOperation(request, {
      userId: user.userId,
      feature: "media_video_enhancement",
      fingerprintInput: input,
    });
    operationId = creditOperation.operationId;
    await assertMediaCreditOperationUnused({
      operationId,
      userId: user.userId,
      requestFingerprint: creditOperation.requestFingerprint,
    });

    let safeUrl = null;
    let sourceName = "";
    let sourceHost = null;
    if (input.source.type === "url") {
      try {
        safeUrl = await assertPublicHttpsMediaUrl(input.source.url);
        assertSafeSourceHost(safeUrl.hostname);
        sourceName = createPublicSourceName(safeUrl.url);
        sourceHost = safeUrl.hostname;
      } catch (error) {
        if (error instanceof URIError) return jsonMessage("公网视频文件名格式不正确", 400);
        return jsonMessage("视频地址未通过安全检查", 400);
      }
    }

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);

    let providerFileId = "";
    let uploadTicket = null;
    if (input.source.type === "upload") {
      uploadTicket = await MediaKitUploadTicket.findOne({
        _id: input.source.uploadTicketId,
        userId: user.userId,
        status: "ready",
        expiresAt: { $gt: new Date() },
      }).select("+providerFileId");
      if (!uploadTicket) {
        const ownedTicket = await MediaKitUploadTicket.exists({
          _id: input.source.uploadTicketId,
          userId: user.userId,
        });
        if (!ownedTicket) return jsonMessage("上传凭证不存在", 404);
        return jsonMessage("上传凭证未就绪、已使用或已过期", 409);
      }
      providerFileId = uploadTicket.providerFileId;
      sourceName = uploadTicket.safeOriginalName;
    }

    const settings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
    reservation = await reserveMediaCredits({
      operationId,
      userId: user.userId,
      feature: "media_video_enhancement",
      provider: "mediakit",
      model: VIDEO_ENHANCEMENT_MODEL,
      estimate: calculateMediaKitCost({ durationSeconds: 60 }, settings),
      settings,
      usage: {
        sourceDurationSeconds: input.sourceDurationSeconds,
        reservedDurationSeconds: 60,
        sourceType: input.source.type,
        resolution: input.resolution,
      },
      executionClaimId: creditOperation.executionClaimId,
      requestFingerprint: creditOperation.requestFingerprint,
    });

    const clientToken = createMediaKitClientToken();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    task = await VideoEnhancementTask.create({
      userId: user.userId,
      model: VIDEO_ENHANCEMENT_MODEL,
      sourceType: input.source.type,
      sourceName,
      sourceHost,
      // 文件直传供应商，公网 URL 也不经过本站媒体解析；这里只能记录用户声明，
      // 不能把它标记成已由服务端核验的真实时长。
      sourceDurationSeconds: input.sourceDurationSeconds,
      sourceDurationVerified: false,
      settings: {
        resolution: input.resolution,
        fps: Object.hasOwn(input, "fps") ? input.fps : null,
        bitrate: input.bitrate,
      },
      clientToken,
      status: "submitting",
      billing: {
        operationId,
        status: reservation.transaction.status,
        reservedPoints: reservation.transaction.reserved,
        chargedPoints: 0,
        refundedPoints: 0,
      },
      billingPricingSnapshot: reservation.pricingSnapshot,
    });

    if (uploadTicket) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const consumedAt = new Date();
      const consumed = await MediaKitUploadTicket.updateOne(
        {
          _id: uploadTicket._id,
          userId: user.userId,
          status: "ready",
          consumedAt: null,
          expiresAt: { $gt: consumedAt },
        },
        { $set: { status: "consumed", consumedAt } },
      );
      if (consumed.modifiedCount !== 1) {
        await releaseMediaCredits({
          reservation,
          operationId,
          userId: user.userId,
          usage: { uploadTicketConsumed: false },
        });
        billingFinalized = true;
        await assertMediaWriteLeaseActive(mediaWriteLease);
        await VideoEnhancementTask.deleteOne({
          _id: task._id,
          userId: user.userId,
          status: "submitting",
          upstreamTaskId: null,
        });
        task = null;
        return jsonMessage("上传凭证已被使用或已过期", 409);
      }
    }

    try {
      submissionStarted = true;
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const submissionMarkedAt = new Date();
      const markedTask = await VideoEnhancementTask.findOneAndUpdate(
        {
          _id: task._id,
          userId: user.userId,
          status: "submitting",
          upstreamTaskId: null,
        },
        { $set: { submissionDispatchedAt: submissionMarkedAt } },
        { new: true },
      ).select("+upstreamTaskId +billingPricingSnapshot");
      if (!markedTask) throw new Error("视频画质增强任务提交状态已变化");
      task = markedTask;
      await releaseCreditExecutionClaim(operationId, creditOperation.executionClaimId);
      const upstream = await submitMediaKitVideoEnhancementTask({
        source: input.source.type === "upload"
          ? { type: "upload", providerFileId }
          : { type: "url", url: safeUrl.url },
        resolution: input.resolution,
        ...(Object.hasOwn(input, "fps") ? { fps: input.fps } : {}),
        bitrate: input.bitrate,
        clientToken,
      }, {
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(TASK_SUBMISSION_TIMEOUT_MS),
        ]),
        onRequestDispatched: () => {
          requestDispatched = true;
        },
      });
      // 从供应商拿到任务号就意味着任务已经真实创建。先记在内存里，后续任何
      // 本地租约或数据库失败都不能再走“未创建任务”的退款分支。
      upstreamTaskId = upstream.taskId;
      upstreamTaskCreatedAt = upstream.createdAt || new Date();
      const syncedAt = new Date();
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const updated = await VideoEnhancementTask.findOneAndUpdate(
        {
          _id: task._id,
          userId: user.userId,
          status: "submitting",
          upstreamTaskId: null,
        },
        {
          $set: {
            upstreamTaskId,
            status: "running",
            upstreamCreatedAt: upstreamTaskCreatedAt || syncedAt,
            lastSyncedAt: syncedAt,
            nextPollAt: new Date(syncedAt.getTime() + NEXT_POLL_DELAY_MS),
          },
        },
        { new: true },
      );
      if (!updated) {
        const stateError = new Error("任务状态已变化");
        stateError.code = "TASK_STATE_CHANGED";
        stateError.status = 409;
        throw stateError;
      }
      task = updated;
    } catch (error) {
      if (upstreamTaskId) {
        const syncedAt = new Date();
        let recoveredTask = null;
        try {
          recoveredTask = await VideoEnhancementTask.findOneAndUpdate(
            {
              _id: task?._id,
              userId: user.userId,
              status: "submitting",
              upstreamTaskId: null,
            },
            {
              $set: {
                upstreamTaskId,
                status: "running",
                upstreamCreatedAt: upstreamTaskCreatedAt || syncedAt,
                lastSyncedAt: syncedAt,
                nextPollAt: new Date(syncedAt.getTime() + NEXT_POLL_DELAY_MS),
              },
              $unset: { lease: 1 },
            },
            { new: true },
          ).select("+upstreamTaskId +billingPricingSnapshot");
          if (!recoveredTask && task?._id) {
            const currentTask = await VideoEnhancementTask.findById(task._id)
              .select("+upstreamTaskId +billingPricingSnapshot");
            if (currentTask?.upstreamTaskId === upstreamTaskId) recoveredTask = currentTask;
          }
        } catch (recoveryError) {
          console.error(
            "[AI MediaKit] persist created upstream task failed",
            safeErrorDetails(recoveryError),
          );
        }

        if (recoveredTask) {
          task = recoveredTask;
          const credit = await getCreditSummary(user.userId);
          const serializedTask = serializeVideoEnhancementTask(task);
          return Response.json({
            success: false,
            message: "供应商任务已创建，系统将在后台继续同步",
            task: serializedTask,
            billing: serializedTask?.billing
              ? { ...serializedTask.billing, credit }
              : null,
            credit,
          }, { status: 202 });
        }

        const reviewed = await reviewMediaCredits({
          reservation,
          operationId,
          userId: user.userId,
          reason: "MediaKit 供应商任务已创建，但本地任务号保存失败",
          usage: {
            sourceDurationSeconds: input.sourceDurationSeconds,
            submissionStarted,
            upstreamTaskId,
            errorCode: error?.code || "",
          },
          upstreamRequestIds: [upstreamTaskId],
        });
        billingFinalized = true;
        return Response.json({
          success: false,
          message: "供应商任务已创建，积分已转人工核对",
          billing: reviewed.billing,
          credit: reviewed.credit,
        }, { status: 500 });
      }

      const failure = normalizeSubmissionFailure(error);
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const failed = await VideoEnhancementTask.findOneAndUpdate(
        { _id: task._id, userId: user.userId, status: "submitting" },
        {
          $set: {
            status: failure.status,
            videoFileId: null,
            result: null,
            error: { code: failure.code },
            nextPollAt: null,
            lastSyncedAt: new Date(),
          },
          $unset: { lease: 1 },
        },
        { new: true },
      ).select("+upstreamTaskId +billingPricingSnapshot");
      if (failed) task = failed;
      task = await finalizeMediaKitTaskBilling(task, {
        status: failure.status,
        unknown: requestDispatched && isAmbiguousSubmissionError(error),
        usage: {
          sourceDurationSeconds: input.sourceDurationSeconds,
          submissionStarted,
          errorCode: error?.code || "",
        },
      });
      billingFinalized = true;
      console.error("[AI MediaKit] submit enhancement task failed", safeErrorDetails(error));
      const credit = await getCreditSummary(user.userId);
      const serializedFailedTask = serializeVideoEnhancementTask(task);
      return Response.json(
        {
          success: false,
          message: failure.message,
          billing: serializedFailedTask?.billing
            ? { ...serializedFailedTask.billing, credit }
            : null,
          credit,
        },
        { status: getErrorStatus(error) },
      );
    }

    const serializedTask = serializeVideoEnhancementTask(task);
    const credit = await getCreditSummary(user.userId);
    return Response.json({
      success: true,
      task: serializedTask,
      billing: serializedTask?.billing
        ? { ...serializedTask.billing, credit }
        : null,
      credit,
    }, { status: 201 });
  } catch (error) {
    if (reservation && !billingFinalized) {
      try {
        if (task) {
          task = await finalizeMediaKitTaskBilling(task, {
            status: requestDispatched ? "unknown" : "failed",
            unknown: requestDispatched,
            usage: { submissionStarted },
          });
          responseBilling = serializeVideoEnhancementTask(task)?.billing || null;
        } else {
          const released = await releaseMediaCredits({
            reservation,
            operationId,
            userId,
            usage: { submissionStarted: false },
          });
          responseBilling = released.billing;
        }
        billingFinalized = true;
      } catch (billingError) {
        console.error("[AI MediaKit] finalize creation billing failed", safeErrorDetails(billingError));
      }
    }
    console.error("[AI MediaKit] create enhancement task failed", safeErrorDetails(error));
    if (error instanceof CreditError) {
      return creditErrorResponse(error, "视频画质增强积分处理失败");
    }
    const credit = reservation
      ? await getCreditSummary(userId).catch(() => null)
      : null;
    return Response.json(
      {
        success: false,
        message: getPublicErrorMessage(error, "创建视频画质增强任务失败"),
        ...(responseBilling
          ? { billing: { ...responseBilling, ...(credit ? { credit } : {}) } }
          : {}),
        ...(credit ? { credit } : {}),
      },
      { status: getErrorStatus(error) },
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[AI MediaKit] release task creation lease failed", safeErrorDetails(error));
      });
    }
  }
}
