import crypto from "node:crypto";
import { mediaServiceResult } from "./result";
import { creditErrorResult } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { calculateFishTtsCost } from "@/lib/server/credits/pricing";
import { getBillingSettings } from "@/lib/server/credits/settings";
import { releaseMediaCredits, reserveMediaCredits, reviewMediaCredits, settleMediaCredits } from "@/lib/media/server/billing";
import { assertMediaCreditOperationUnused, createMediaCreditOperation } from "@/lib/media/server/creditOperation";
import { FISH_AUDIO_MODEL, parseFishSpeechInput } from "@/lib/media/shared/fishAudio";
import { FishAudioError, fishErrorStatus, fishPublicMessage, getFishVoice, synthesizeFishSpeech } from "@/lib/media/server/fishAudio";
import { serializeFishAudioGeneration } from "@/lib/media/server/fishAudioRecords";
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from "@/lib/media/server/userOperationLeases";
import { saveGeneratedAudioBuffer } from "@/lib/media/storage";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import FishAudioGeneration from "@/models/FishAudioGeneration";
import FishVoice from "@/models/FishVoice";

export async function resolveFishVoice({ userId, voiceId, signal }) {
  const record = await FishVoice.findOne({ userId, voiceId }).lean();
  if (!record) throw new FishAudioError("请选择本人复刻的音色", { status: 404 });
  const voice = await getFishVoice(voiceId, { signal });
  if (voice.state !== "trained" || voice.dmca_taken_down) {
    throw new FishAudioError("该音色尚未就绪，请刷新音色状态或选择其他音色", { status: 409 });
  }
  return {
    voiceId: voice._id,
    voiceName: record.displayName,
    languages: Array.isArray(voice.languages) ? voice.languages : [],
  };
}

async function pruneGenerationHistory(userId) {
  const stale = await FishAudioGeneration.find({ userId }).sort({ createdAt: -1, _id: -1 }).skip(100).select("_id generationId").lean();
  for (const generation of stale) {
    await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: generation.generationId });
    await FishAudioGeneration.deleteOne({ _id: generation._id, userId });
  }
}

async function runFishSpeech({ userId, body, clientOperationId, signal, preview }) {
  let mediaWriteLease = null;
  let reservation = null;
  let requestDispatched = false;
  let upstreamComplete = false;
  let billing = null;
  let upstreamRequestIds = [];
  try {
    mediaWriteLease = await beginMediaWriteLease(userId);
    let input = parseFishSpeechInput(preview ? { text: "你好，这是我的声音。", voiceId: body?.voiceId } : body);
    const voice = await resolveFishVoice({ userId, voiceId: input.voiceId, signal });
    if (preview && voice.languages.length && !voice.languages.some((language) => /^zh(?:-|$)/i.test(language))) {
      input = { ...input, text: "Hello, this is my voice." };
    }
    const feature = preview ? "fish_tts_preview" : "fish_tts_generate";
    const creditOperation = createMediaCreditOperation({ clientOperationId, userId, feature, fingerprintInput: input });
    const { operationId } = creditOperation;
    await assertMediaCreditOperationUnused({ operationId, userId, requestFingerprint: creditOperation.requestFingerprint });
    const usage = { bytes: Buffer.byteLength(input.text, "utf8"), characters: input.text.length };
    const settings = await getBillingSettings();
    reservation = await reserveMediaCredits({
      operationId,
      userId,
      feature,
      provider: "fish",
      model: FISH_AUDIO_MODEL,
      settings,
      usage,
      executionClaimId: creditOperation.executionClaimId,
      requestFingerprint: creditOperation.requestFingerprint,
    });
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const upstream = await synthesizeFishSpeech(input, {
      signal,
      onRequestDispatched: () => { requestDispatched = true; },
      onUpstreamComplete: () => { upstreamComplete = true; },
    });
    upstreamRequestIds = [upstream.requestId].filter(Boolean);
    const settled = await settleMediaCredits({
      reservation,
      operationId,
      actual: calculateFishTtsCost({ bytes: upstream.bytes }, settings),
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
      generation = await FishAudioGeneration.create({
        generationId,
        userId,
        ...input,
        model: FISH_AUDIO_MODEL,
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
    await pruneGenerationHistory(userId).catch((error) => {
      console.error("[Fish Audio] prune history:", error);
    });
    return mediaServiceResult({ success: true, generation: serializeFishAudioGeneration(generation), billing }, { status: 201 });
  } catch (error) {
    if (reservation && !billing) {
      try {
        const result = !requestDispatched || error?.upstreamRejected === true
          ? await releaseMediaCredits({ reservation, operationId: reservation.transaction.operationId, upstreamRequestIds: upstreamRequestIds.length ? upstreamRequestIds : [error?.requestId].filter(Boolean) })
          : await reviewMediaCredits({
              operationId: reservation.transaction.operationId,
              reason: upstreamComplete ? "Fish Audio 已返回音频，费用结算待核实" : "Fish Audio 请求已发出，生成结果待核实",
              upstreamRequestIds: upstreamRequestIds.length ? upstreamRequestIds : [error?.requestId].filter(Boolean),
            });
        billing = result.billing;
      } catch (billingError) {
        console.error("[Fish Audio] finalize billing:", billingError);
      }
    }
    if (error instanceof CreditError && !reservation) return creditErrorResult(error, "语音费用记录失败");
    console.error("[Fish Audio] speech:", error);
    return mediaServiceResult({
      success: false,
      message: fishPublicMessage(error, preview ? "音色试听失败" : "语音生成失败"),
      ...(billing ? { billing } : {}),
    }, { status: fishErrorStatus(error) });
  } finally {
    if (mediaWriteLease) await endMediaWriteLease(mediaWriteLease).catch((error) => {
      console.error("[Fish Audio] release media lease:", error);
    });
  }
}

export function generateFishSpeech(options) {
  return runFishSpeech({ ...options, preview: false });
}

export function previewFishSpeech(options) {
  return runFishSpeech({ ...options, preview: true });
}
