import crypto from "node:crypto";
import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { readMultipart } from "@/lib/server/files/uploads";
import { createMiniMaxVoice, deleteMiniMaxVoice, listMiniMaxVoices, minimaxErrorStatus, minimaxPublicMessage, minimaxVoiceLanguages } from "@/lib/media/server/minimaxAudio";
import { serializeMiniMaxVoice } from "@/lib/media/server/audioRecords";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";
import { acquireVoiceCreationLease, assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease, releaseVoiceCreationLease } from "@/lib/media/server/userOperationLeases";
import { MINIMAX_VOICE_MAX_COUNT, MINIMAX_VOICE_SAMPLE_MAX_BYTES, MINIMAX_VOICE_SAMPLE_MAX_SECONDS, MINIMAX_VOICE_SAMPLE_MIN_SECONDS } from "@/lib/media/shared/minimaxAudio";
import MiniMaxVoice from "@/models/MiniMaxVoice";
import { getMediaSettings, getSharedAudioVoice } from '@/lib/server/media/settings';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const voices = await MiniMaxVoice.find({ userId: auth.payload.userId }).sort({ createdAt: -1 }).lean();
    const sharedId = await getSharedAudioVoice('minimax');
    const { minimaxAudio } = await getMediaSettings();
    const system = minimaxAudio.enabled && minimaxAudio.hasApiKey ? await listMiniMaxVoices('system', { signal: request.signal }) : [];
    const builtin = system.map(voice => ({ profileId: `builtin:${voice.voice_id}`, voiceId: voice.voice_id, displayName: voice.voice_name || voice.voice_id, description: (voice.description || []).join(' '), status: 'trained', languages: minimaxVoiceLanguages(voice.voice_id), builtin: true }));
    const shared = sharedId && !voices.some(voice => voice.voiceId === sharedId) && !builtin.some(voice => voice.voiceId === sharedId)
      ? [{ profileId: `shared:${sharedId}`, voiceId: sharedId, displayName: 'MiniMax', status: 'trained', languages: [], shared: true }]
      : [];
    return Response.json({ success: true, voices: [...voices.map(serializeMiniMaxVoice), ...shared, ...builtin] });
  } catch (error) {
    return Response.json({ success: false, message: minimaxPublicMessage(error, "读取声音库失败") }, { status: minimaxErrorStatus(error) });
  }
}

async function POSTHandler(request) {
  let lease;
  let creationLease;
  let createdVoiceId;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const userId = String(auth.payload.userId);
    if (!rateLimit(`minimax-clone:${userId}:${getClientIP(request)}`, { limit: 5, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "声音复刻请求较多，请稍后再试" }, { status: 429 });
    }
    const form = await readMultipart(request, MINIMAX_VOICE_SAMPLE_MAX_BYTES + 64 * 1024);
    const displayName = typeof form.get("displayName") === "string" ? form.get("displayName").trim() : "";
    if (!displayName || displayName.length > 60) throw Object.assign(new Error("请填写 1 到 60 个字的音色名称"), { status: 400 });
    if (form.get("consentConfirmed") !== "true") throw Object.assign(new Error("请确认拥有声音样本的使用授权"), { status: 400 });
    const options = Object.fromEntries(["needNoiseReduction", "needVolumeNormalization"].map(field => [field, form.get(field)]));
    if (Object.values(options).some(value => value !== "true" && value !== "false")) throw Object.assign(new Error("请选择是否降噪和音量归一化"), { status: 400 });
    const sample = form.get("sample");
    if (!(sample instanceof File) || sample.size === 0 || sample.size > MINIMAX_VOICE_SAMPLE_MAX_BYTES) {
      throw Object.assign(new Error("请上传 20 MB 以内的声音样本"), { status: 400 });
    }
    const extension = sample.name.split(".").pop().toLowerCase();
    if (!["mp3", "wav", "m4a"].includes(extension)) throw Object.assign(new Error("请上传 WAV、MP3 或 M4A 音频"), { status: 400 });
    let metadata;
    try {
      metadata = inspectAudioMetadata(Buffer.from(await sample.arrayBuffer()), extension);
    } catch {
      throw Object.assign(new Error("声音样本内容有误，请重新选择可播放的音频文件"), { status: 400 });
    }
    if (metadata.durationSeconds < MINIMAX_VOICE_SAMPLE_MIN_SECONDS || metadata.durationSeconds > MINIMAX_VOICE_SAMPLE_MAX_SECONDS) {
      throw Object.assign(new Error("声音样本时长须在 10 秒到 5 分钟之间"), { status: 400 });
    }
    lease = await beginMediaWriteLease(userId);
    creationLease = await acquireVoiceCreationLease(userId);
    if (await MiniMaxVoice.countDocuments({ userId }) >= MINIMAX_VOICE_MAX_COUNT) {
      throw Object.assign(new Error(`最多保存 ${MINIMAX_VOICE_MAX_COUNT} 个复刻音色，请先删除闲置音色`), { status: 409 });
    }
    await assertMediaWriteLeaseActive(lease);
    const needNoiseReduction = options.needNoiseReduction === "true";
    const needVolumeNormalization = options.needVolumeNormalization === "true";
    const upstream = await createMiniMaxVoice({ voiceId: `Vectaix${crypto.randomUUID().replaceAll("-", "")}`, sample, needNoiseReduction, needVolumeNormalization, signal: request.signal });
    createdVoiceId = upstream.voiceId;
    await assertMediaWriteLeaseActive(lease);
    const record = await MiniMaxVoice.create({
      userId,
      voiceId: upstream.voiceId,
      displayName,
      languages: [],
      sampleFileName: sample.name.slice(0, 200),
      needNoiseReduction,
      needVolumeNormalization,
      consentConfirmedAt: new Date(),
      lastStatusCheckedAt: new Date(),
    });
    createdVoiceId = "";
    return Response.json({ success: true, voice: serializeMiniMaxVoice(record) }, { status: 201 });
  } catch (error) {
    if (createdVoiceId) await deleteMiniMaxVoice(createdVoiceId).catch((cleanupError) => {
      console.error("[MiniMax] cleanup unpersisted voice:", cleanupError);
    });
    return Response.json({ success: false, message: minimaxPublicMessage(error, "声音复刻失败") }, { status: minimaxErrorStatus(error) });
  } finally {
    if (creationLease) await releaseVoiceCreationLease(creationLease).catch((error) => { console.error("[MiniMax] release voice lease:", error); });
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[MiniMax] release media lease:", error); });
  }
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
