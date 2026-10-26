import crypto from "node:crypto";
import { mediaServiceResult } from "./result";
import { creditErrorResult } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { getBillingSettings } from "@/lib/server/credits/settings";
import { releaseMediaCredits, reserveMediaCredits, reviewMediaCredits, settleMediaCredits } from "@/lib/media/server/billing";
import { assertMediaCreditOperationUnused, createMediaCreditOperation } from "@/lib/media/server/creditOperation";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import { saveGeneratedAudioBuffer } from "@/lib/media/storage";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";

async function pruneGenerationHistory(userId, Generation) {
  const stale = await Generation.find({ userId }).sort({ createdAt: -1, _id: -1 }).skip(100).select("_id generationId").lean();
  for (const generation of stale) {
    await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: generation.generationId });
    await Generation.deleteOne({ _id: generation._id, userId });
  }
}

export async function runSpeech({ userId, body, clientOperationId, signal, preview }, service) {
  const { provider, model, parseInput, resolveVoice, synthesize, Generation, serializeGeneration, calculateCost, publicMessage, errorStatus } = service;
  let mediaWriteLease = null;
  let reservation = null;
  let requestDispatched = false;
  let upstreamComplete = false;
  let billing = null;
  let upstreamRequestIds = [];
  try {
    mediaWriteLease = await beginMediaWriteLease(userId);
    let input = parseInput(preview ? { text: "你好，这是我的声音。", voiceId: body?.voiceId } : body);
    const voice = await resolveVoice({ userId, voiceId: input.voiceId, signal });
    if (preview && voice.languages.length && !voice.languages.some((language) => /^zh(?:-|$)/i.test(language))) {
      input = { ...input, text: "Hello, this is my voice." };
    }
    const feature = `${provider}_tts_${preview ? "preview" : "generate"}`;
    const creditOperation = createMediaCreditOperation({ clientOperationId, userId, feature, fingerprintInput: input });
    const { operationId } = creditOperation;
    await assertMediaCreditOperationUnused({ operationId, userId, requestFingerprint: creditOperation.requestFingerprint });
    const usage = { bytes: Buffer.byteLength(input.text, "utf8"), characters: input.text.length };
    const settings = await getBillingSettings();
    reservation = await reserveMediaCredits({
      operationId,
      userId,
      feature,
      provider,
      model,
      settings,
      usage,
      executionClaimId: creditOperation.executionClaimId,
      requestFingerprint: creditOperation.requestFingerprint,
    });
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const upstream = await synthesize(input, {
      signal,
      onRequestDispatched: () => { requestDispatched = true; },
      onUpstreamComplete: () => { upstreamComplete = true; },
    });
    upstreamRequestIds = [upstream.requestId].filter(Boolean);
    const settled = await settleMediaCredits({
      reservation,
      operationId,
      actual: calculateCost(upstream, settings),
      usage: { bytes: upstream.bytes, characters: upstream.characters },
      upstreamRequestIds,
    });
    billing = settled.billing;
    if (preview) return { status: 200, audioBuffer: upstream.audioBuffer, mimeType: upstream.mimeType, billing };

    const generationId = crypto.randomUUID();
    let generation;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const saved = await saveGeneratedAudioBuffer({
        userId,
        input: upstream.audioBuffer,
        mimeType: upstream.mimeType,
        ownerId: generationId,
        mediaWriteLease,
      });
      await assertMediaWriteLeaseActive(mediaWriteLease);
      generation = await Generation.create({
        generationId,
        userId,
        ...input,
        model,
        voiceName: voice.voiceName,
        bytes: upstream.bytes,
        characters: upstream.characters,
        requestId: upstream.requestId,
        audioFileId: saved.fileId,
      });
    } catch (error) {
      await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: generationId });
      throw error;
    }
    await pruneGenerationHistory(userId, Generation).catch((error) => {
      console.error("[语音服务] prune history:", error);
    });
    return mediaServiceResult({ success: true, generation: serializeGeneration(generation), billing }, { status: 201 });
  } catch (error) {
    if (reservation && !billing) {
      try {
        const result = !requestDispatched || error?.upstreamRejected === true
          ? await releaseMediaCredits({ reservation, operationId: reservation.transaction.operationId, upstreamRequestIds: upstreamRequestIds.length ? upstreamRequestIds : [error?.requestId].filter(Boolean) })
          : await reviewMediaCredits({
              operationId: reservation.transaction.operationId,
              reason: upstreamComplete ? "语音服务已返回音频，费用结算待核实" : "语音服务请求已发出，生成结果待核实",
              upstreamRequestIds: upstreamRequestIds.length ? upstreamRequestIds : [error?.requestId].filter(Boolean),
            });
        billing = result.billing;
      } catch (billingError) {
        console.error("[语音服务] finalize billing:", billingError);
      }
    }
    if (error instanceof CreditError && !reservation) return creditErrorResult(error, "语音费用记录失败");
    console.error("[语音服务] speech:", error);
    return mediaServiceResult({
      success: false,
      message: publicMessage(error, preview ? "音色试听失败" : "语音生成失败"),
      ...(billing ? { billing } : {}),
    }, { status: errorStatus(error) });
  } finally {
    if (mediaWriteLease) await endMediaWriteLease(mediaWriteLease).catch((error) => {
      console.error("[语音服务] release media lease:", error);
    });
  }
}

