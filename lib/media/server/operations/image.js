import { mediaServiceResult } from "./result";
import { creditErrorResult } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { getBillingSettings } from "@/lib/server/credits/settings";
import { releaseMediaCredits, reserveMediaCredits, reviewMediaCredits } from "@/lib/media/server/billing";
import { assertMediaCreditOperationUnused, createMediaCreditOperation } from "@/lib/media/server/creditOperation";
import { getImageModelConfig } from "@/lib/media/shared/models";
import { beginMediaWriteLease, endMediaWriteLease, assertMediaWriteLeaseActive } from "@/lib/media/server/userOperationLeases";
import { createAndStoreImageFiles, finalizeImageBilling, getImageFeature, imageBillingUsage, prepareImageRequest, publicImageError, resolveImageServiceConfig } from "@/lib/media/server/imageService";

export function generateImage(input) {
  return executeImageOperation(input);
}

export async function executeImageOperation({ userId, body, clientOperationId, signal }, { edit = false } = {}) {
  let mediaWriteLease = null;
  let reservation = null;
  let requestDispatched = false;
  let billing = null;
  let batch = null;
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
    batch = await createAndStoreImageFiles({
      ...options, prompt, images, userId, signal, mediaWriteLease,
      ownerType: "image-result", ownerId: userId,
      onRequestDispatched: () => { requestDispatched = true; },
    });
    const settled = await finalizeImageBilling({ reservation, options, inputImageCount: images.length, outcomes: batch.outcomes });
    billing = settled.billing;
    const success = batch.results.some(item => item.success);
    return mediaServiceResult({ success, results: batch.results, billing, ...(!success ? { message: batch.results[0].message } : {}) }, { status: success ? 200 : batch.results[0].status });
  } catch (error) {
    if (reservation && !billing) {
      try {
        const details = { reservation, operationId: reservation.transaction.operationId, usage: { ...reservation.transaction.usage, ...(batch ? { imageOutcomes: batch.outcomes } : {}) }, upstreamRequestIds: batch ? batch.outcomes.flatMap(item => item.attempts.map(attempt => attempt.requestId)).filter(Boolean) : [] };
        const result = !requestDispatched || error?.upstreamRejected === true
          ? await releaseMediaCredits(details)
          : await reviewMediaCredits({ ...details, reason: "图片费用记录未完成" });
        billing = result.billing;
      } catch (billingError) {
        console.error("[Media] image billing:", { name: billingError.name, code: billingError.code });
      }
    }
    if (error instanceof CreditError && !reservation) return creditErrorResult(error, "图片费用记录失败");
    console.error("[Media] image:", { name: error?.name, code: error?.code, status: error?.status });
    if (batch?.results.some(item => item.success)) return mediaServiceResult({ success: true, results: batch.results, billing });
    const { message, status } = publicImageError(error);
    return mediaServiceResult({ success: false, ...(batch ? { results: batch.results } : {}), message, ...(billing ? { billing } : {}) }, { status });
  } finally {
    if (mediaWriteLease) await endMediaWriteLease(mediaWriteLease).catch(error => console.error("[Media] release image write lease:", error.name));
  }
}
