import { mediaServiceResult } from "./result";
import { creditErrorResult } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { getBillingSettings } from "@/lib/server/credits/settings";
import { releaseMediaCredits, reserveMediaCredits, reviewMediaCredits } from "@/lib/media/server/billing";
import { assertMediaCreditOperationUnused, createMediaCreditOperation } from "@/lib/media/server/creditOperation";
import { getImageModelConfig } from "@/lib/media/shared/models";
import { beginMediaWriteLease, endMediaWriteLease, assertMediaWriteLeaseActive } from "@/lib/media/server/userOperationLeases";
import { createAndStoreImageFile, finalizeImageBilling, getImageFeature, imageBillingUsage, prepareImageRequest, resolveImageServiceConfig } from "@/lib/media/server/imageService";

export function generateImage(input) {
  return executeImageOperation(input);
}

export async function executeImageOperation({ userId, body, clientOperationId, signal }, { edit = false } = {}) {
  let mediaWriteLease = null;
  let reservation = null;
  let requestDispatched = false;
  let upstreamComplete = false;
  let billing = null;
  let upstreamRequestIds = [];
  try {
    const { options, prompt, images, imageDigests } = await prepareImageRequest(body, { edit });
    resolveImageServiceConfig(options.model);
    const feature = getImageFeature(options.model, edit);
    const operation = createMediaCreditOperation({ clientOperationId, userId, feature, fingerprintInput: { ...options, prompt, imageDigests } });
    await assertMediaCreditOperationUnused({ ...operation, userId });
    reservation = await reserveMediaCredits({
      ...operation, userId, feature,
      provider: getImageModelConfig(options.model).service,
      model: options.model,
      settings: await getBillingSettings(),
      usage: imageBillingUsage(options, images.length),
    });
    mediaWriteLease = await beginMediaWriteLease(userId);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const saved = await createAndStoreImageFile({
      ...options, prompt, images, userId, signal, mediaWriteLease,
      ownerType: "image-result", ownerId: userId,
      onRequestDispatched: () => { requestDispatched = true; },
      onUpstreamComplete: async ({ requestId, usage }) => {
        upstreamComplete = true;
        upstreamRequestIds = [requestId].filter(Boolean);
        const result = await finalizeImageBilling({ reservation, options, inputImageCount: images.length, upstreamUsage: usage, upstreamRequestIds });
        billing = result.billing;
      },
    });
    return mediaServiceResult({ success: true, imageUrl: saved.url, billing });
  } catch (error) {
    if (reservation && !billing) {
      try {
        const details = { reservation, operationId: reservation.transaction.operationId, usage: reservation.transaction.usage, upstreamRequestIds: upstreamRequestIds.length ? upstreamRequestIds : [error?.requestId].filter(Boolean) };
        const result = !requestDispatched || error?.upstreamRejected === true
          ? await releaseMediaCredits(details)
          : await reviewMediaCredits({ ...details, reason: upstreamComplete ? "图片上游已成功，但费用记录未完成" : "图片请求已发出，但未能确认完整结果" });
        billing = result.billing;
      } catch (billingError) {
        console.error("[Media] image billing:", { name: billingError.name, code: billingError.code });
      }
    }
    if (error instanceof CreditError && !reservation) return creditErrorResult(error, "图片费用记录失败");
    console.error("[Media] image:", { name: error?.name, code: error?.code, status: error?.status });
    return mediaServiceResult({ success: false, message: error.message, ...(billing ? { billing } : {}) }, { status: error.status || error.statusCode || 500 });
  } finally {
    if (mediaWriteLease) await endMediaWriteLease(mediaWriteLease).catch(error => console.error("[Media] release image write lease:", error.name));
  }
}
