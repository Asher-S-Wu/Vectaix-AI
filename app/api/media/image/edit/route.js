import { getAuthPayload } from "@/lib/auth";
import crypto from "node:crypto";
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
  editAndStoreImage,
  isExplicitQwenImageRejection,
} from "@/lib/media/server/qwenImage";
import {
  assertMediaCreditOperationUnused,
  requireMediaCreditOperation,
} from "@/lib/media/server/creditOperation";
import {
  IMAGE_MODEL,
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_ACCEPTED_EXTENSIONS,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_EDIT_MAX_COUNT,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from "@/lib/media/shared/models";
import { getFileExtension } from "@/lib/shared/attachments";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
  assertMediaWriteLeaseActive,
} from "@/lib/media/server/userOperationLeases";

const ALLOWED_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((item) => item.id));
const ALLOWED_MIME_TYPES = new Set(IMAGE_EDIT_ACCEPTED_MIME_TYPES);

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

    const formData = await request.formData();
    const prompt = String(formData.get("prompt") || "").trim();
    const size = String(formData.get("size") || "auto");
    const images = formData.getAll("images");

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

    if (images.length === 0 || images.length > IMAGE_EDIT_MAX_COUNT) {
      return Response.json(
        { success: false, message: `请上传 1 至 ${IMAGE_EDIT_MAX_COUNT} 张参考图片` },
        { status: 400 }
      );
    }

    const normalizedImages = [];
    const imageDigests = [];
    for (const image of images) {
      const extension = image instanceof File ? getFileExtension(image.name) : "";
      if (!(image instanceof File) || !IMAGE_EDIT_ACCEPTED_EXTENSIONS.includes(extension)) {
        return Response.json(
          { success: false, message: "仅支持 JPG、PNG、BMP、TIFF、WEBP、GIF 图片" },
          { status: 400 }
        );
      }
      if (image.size <= 0 || image.size > IMAGE_EDIT_MAX_BYTES) {
        return Response.json(
          { success: false, message: "每张参考图片不能超过 10MB" },
          { status: 400 }
        );
      }
      const input = Buffer.from(await image.arrayBuffer());
      const inspected = inspectUploadedFile(input, extension);
      if (!inspected || !ALLOWED_MIME_TYPES.has(inspected.mimeType)) {
        return Response.json(
          { success: false, message: "图片内容与文件格式不一致" },
          { status: 400 }
        );
      }
      normalizedImages.push(new File([input], image.name, { type: inspected.mimeType }));
      imageDigests.push(crypto.createHash("sha256").update(input).digest("hex"));
    }

    const resolution = size === "auto" ? "2K" : "1K";
    const creditOperation = requireMediaCreditOperation(request, {
      userId: auth.userId,
      feature: "qwen_image_edit",
      fingerprintInput: { prompt, size, imageDigests },
    });
    const operationId = creditOperation.operationId;
    await assertMediaCreditOperationUnused({
      operationId,
      userId: auth.userId,
      requestFingerprint: creditOperation.requestFingerprint,
    });
    try {
      const settings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
      const estimate = calculateQwenImageCost({ resolution, inputImageCount: normalizedImages.length }, settings);
      reservation = await reserveMediaCredits({
        operationId,
        userId: auth.userId,
        feature: "qwen_image_edit",
        provider: "qwen",
        model: IMAGE_MODEL,
        estimate,
        settings,
        usage: { resolution, inputImageCount: normalizedImages.length },
        executionClaimId: creditOperation.executionClaimId,
        requestFingerprint: creditOperation.requestFingerprint,
      });
    } catch (error) {
      return creditErrorResponse(error, "图片编辑积分预留失败");
    }

    mediaWriteLease = await beginMediaWriteLease(auth.userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const imageUrl = await editAndStoreImage({
      userId: auth.userId,
      prompt,
      images: normalizedImages,
      size,
      signal: request.signal,
      mediaWriteLease,
      onRequestDispatched: () => {
        requestDispatched = true;
      },
      onUpstreamComplete: async ({ requestId }) => {
        upstreamComplete = true;
        upstreamRequestIds = [requestId].filter(Boolean);
        const actual = calculateQwenImageCost({
          resolution,
          inputImageCount: normalizedImages.length,
        }, reservation.settings);
        const settled = await settleMediaCredits({
          reservation,
          operationId,
          userId: auth.userId,
          actual,
          usage: { resolution, inputImageCount: normalizedImages.length },
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
              upstreamRequestIds: [error?.requestId].filter(Boolean),
            })
          : await reviewMediaCredits({
            reservation,
            operationId: reservation.transaction.operationId,
            userId: auth.userId,
            reason: upstreamComplete
              ? "图片编辑上游已成功，但固定成本结算未完成"
              : "图片编辑上游请求已发出，但未能确认完整结果",
            upstreamRequestIds: upstreamRequestIds.length
              ? upstreamRequestIds
              : [error?.requestId].filter(Boolean),
          });
        billing = result.billing;
        billingFinalized = true;
      } catch { /* keep the original error */ }
    }
    console.error("[Media] edit image:", error);
    if (error instanceof CreditError && !reservation) {
      return creditErrorResponse(error, "图片编辑积分预留失败");
    }
    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "图片编辑失败",
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
        console.error("[Media] release image edit write lease:", error);
      });
    }
  }
}
