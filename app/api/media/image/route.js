import { getAuthPayload } from "@/lib/auth";
import { creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { calculateQwenImageCost } from "@/lib/server/credits/pricing";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
  settleMediaCredits,
} from "@/lib/media/server/billing";
import dbConnect from "@/lib/db";
import {
  generateAndStoreImage,
  isExplicitQwenImageRejection,
} from "@/lib/media/server/qwenImage";
import {
  assertMediaCreditOperationUnused,
  requireMediaCreditOperation,
} from "@/lib/media/server/creditOperation";
import { IMAGE_PROMPT_MAX_LENGTH, IMAGE_SIZE_OPTIONS } from "@/lib/media/shared/models";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
  assertMediaWriteLeaseActive,
} from "@/lib/media/server/userOperationLeases";

const ALLOWED_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((item) => item.id));

export async function POST(request) {
  let mediaWriteLease = null;
  let reservation = null;
  let auth = null;
  let requestDispatched = false;
  let upstreamComplete = false;
  let billingFinalized = false;
  let billing = null;
  let upstreamRequestIds = [];
  try {
    auth = await getAuthPayload(request);
    if (!auth) {
      return Response.json({ success: false, message: "未登录" }, { status: 401 });
    }
    await dbConnect();

    const body = await request.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const size = typeof body?.size === "string" ? body.size : "auto";

    if (!prompt) {
      return Response.json({ success: false, message: "请输入图片描述" }, { status: 400 });
    }

    if (prompt.length > IMAGE_PROMPT_MAX_LENGTH) {
      return Response.json(
        { success: false, message: `描述最多支持 ${IMAGE_PROMPT_MAX_LENGTH} 个字符` },
        { status: 400 }
      );
    }

    if (!ALLOWED_SIZES.has(size)) {
      return Response.json({ success: false, message: "不支持的图片尺寸" }, { status: 400 });
    }

    const resolution = size === "auto" ? "2K" : "1K";
    const creditOperation = requireMediaCreditOperation(request, {
      userId: auth.userId,
      feature: "qwen_image_generate",
      fingerprintInput: { prompt, size },
    });
    const operationId = creditOperation.operationId;
    await assertMediaCreditOperationUnused({
      operationId,
      userId: auth.userId,
      requestFingerprint: creditOperation.requestFingerprint,
    });
    try {
      const settings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
      const estimate = calculateQwenImageCost({ resolution }, settings);
      reservation = await reserveMediaCredits({
        operationId,
        userId: auth.userId,
        feature: "qwen_image_generate",
        provider: "qwen",
        model: "qwen-image-3.0-pro",
        estimate,
        settings,
        usage: { resolution, inputImageCount: 0 },
        executionClaimId: creditOperation.executionClaimId,
        requestFingerprint: creditOperation.requestFingerprint,
      });
    } catch (error) {
      return creditErrorResponse(error, "图片生成积分预留失败");
    }

    mediaWriteLease = await beginMediaWriteLease(auth.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const imageUrl = await generateAndStoreImage({
      userId: auth.userId,
      prompt,
      size,
      signal: request.signal,
      mediaWriteLease,
      onRequestDispatched: () => {
        requestDispatched = true;
      },
      onUpstreamComplete: async ({ requestId }) => {
        upstreamComplete = true;
        upstreamRequestIds = [requestId].filter(Boolean);
        const actual = calculateQwenImageCost({ resolution, inputImageCount: 0 }, reservation.settings);
        const settled = await settleMediaCredits({
          reservation,
          operationId,
          userId: auth.userId,
          actual,
          usage: { resolution, inputImageCount: 0 },
          upstreamRequestIds,
        });
        billing = settled.billing;
        billingFinalized = true;
      },
    });
    return Response.json({ success: true, imageUrl, billing });
  } catch (error) {
    if (reservation && auth?.userId && !billingFinalized) {
      try {
        const result = !requestDispatched || isExplicitQwenImageRejection(error)
          ? await releaseMediaCredits({
              reservation,
              operationId: reservation.transaction.operationId,
              userId: auth.userId,
              usage: { resolution: reservation.transaction.usage?.resolution || "" },
              upstreamRequestIds: [error?.requestId].filter(Boolean),
            })
          : await reviewMediaCredits({
            reservation,
            operationId: reservation.transaction.operationId,
            userId: auth.userId,
            reason: upstreamComplete
              ? "图片上游已成功，但固定成本结算未完成"
              : "图片上游请求已发出，但未能确认完整结果",
            upstreamRequestIds: upstreamRequestIds.length
              ? upstreamRequestIds
              : [error?.requestId].filter(Boolean),
          });
        billing = result.billing;
        billingFinalized = true;
      } catch { /* keep the original error */ }
    }
    console.error("[Media] generate image:", error);
    if (error instanceof CreditError && !reservation) {
      return creditErrorResponse(error, "图片生成积分预留失败");
    }
    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "图片生成失败",
        ...(billing ? { billing } : {}),
      },
      {
        status: Number.isInteger(error?.status)
          ? error.status
          : Number.isInteger(error?.statusCode)
            ? error.statusCode
            : 500,
      }
    );
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media] release image write lease:", error);
      });
    }
  }
}
