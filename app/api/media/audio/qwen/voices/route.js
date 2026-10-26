import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { readMultipart } from "@/lib/server/files/uploads";
import { createQwenVoice, deleteQwenVoice, qwenErrorStatus, qwenPublicMessage } from "@/lib/media/server/qwenAudio";
import { serializeVoice } from "@/lib/media/server/audioRecords";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";
import { acquireVoiceCreationLease, assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease, releaseVoiceCreationLease } from "@/lib/media/server/userOperationLeases";
import { QWEN_BUILTIN_VOICES, QWEN_VOICE_SAMPLE_MAX_BYTES, QWEN_VOICE_MAX_COUNT } from "@/lib/media/shared/qwenAudio";
import QwenVoice from "@/models/QwenVoice";
import { getSharedAudioVoice } from '@/lib/server/media/settings';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const voices = await QwenVoice.find({ userId: auth.payload.userId }).sort({ createdAt: -1 }).lean();
    const sharedId = await getSharedAudioVoice('qwen');
    const shared = sharedId && !QWEN_BUILTIN_VOICES.some(voice => voice.voiceId === sharedId) && !voices.some(voice => voice.voiceId === sharedId)
      ? await QwenVoice.findOne({ voiceId: sharedId }).lean()
      : null;
    return Response.json({ success: true, voices: [...QWEN_BUILTIN_VOICES, ...voices.map(serializeVoice), ...(shared ? [{ profileId: `shared:${sharedId}`, voiceId: shared.voiceId, displayName: shared.displayName, status: shared.status, languages: shared.languages, shared: true }] : [])] });
  } catch (error) {
    return Response.json({ success: false, message: qwenPublicMessage(error, "读取声音库失败") }, { status: qwenErrorStatus(error) });
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
    if (!rateLimit(`qwen-clone:${userId}:${getClientIP(request)}`, { limit: 5, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "声音复刻请求较多，请稍后再试" }, { status: 429 });
    }
    const form = await readMultipart(request, QWEN_VOICE_SAMPLE_MAX_BYTES + 64 * 1024);
    const displayName = typeof form.get("displayName") === "string" ? form.get("displayName").trim() : "";
    if (!displayName || displayName.length > 60) throw Object.assign(new Error("请填写 1 到 60 个字的音色名称"), { status: 400 });
    if (form.get("consentConfirmed") !== "true") throw Object.assign(new Error("请确认拥有声音样本的使用授权"), { status: 400 });
    const sample = form.get("sample");
    if (!(sample instanceof File) || sample.size === 0 || sample.size > QWEN_VOICE_SAMPLE_MAX_BYTES) {
      throw Object.assign(new Error("请上传 10 MB 以内的声音样本"), { status: 400 });
    }
    const extension = sample.name.split(".").pop().toLowerCase();
    if (!["mp3", "wav", "m4a"].includes(extension)) throw Object.assign(new Error("请上传 WAV、MP3 或 M4A 音频"), { status: 400 });
    let metadata;
    try {
      metadata = inspectAudioMetadata(Buffer.from(await sample.arrayBuffer()), extension);
    } catch {
      throw Object.assign(new Error("声音样本内容有误，请重新选择可播放的音频文件"), { status: 400 });
    }
    if (metadata.durationSeconds < 5 || metadata.durationSeconds > 60) {
      throw Object.assign(new Error("声音样本时长须在 5 秒到 60 秒之间"), { status: 400 });
    }
    if (metadata.sampleRate < 16000) throw Object.assign(new Error("声音样本采样率须至少为 16 kHz"), { status: 400 });
    lease = await beginMediaWriteLease(userId);
    creationLease = await acquireVoiceCreationLease(userId);
    if (await QwenVoice.countDocuments({ userId }) >= QWEN_VOICE_MAX_COUNT) {
      throw Object.assign(new Error(`最多保存 ${QWEN_VOICE_MAX_COUNT} 个复刻音色，请先删除闲置音色`), { status: 409 });
    }
    await assertMediaWriteLeaseActive(lease);
    const upstream = await createQwenVoice({ sample, signal: request.signal });
    createdVoiceId = upstream._id;
    await assertMediaWriteLeaseActive(lease);
    const record = await QwenVoice.create({
      userId,
      voiceId: upstream._id,
      displayName,
      status: upstream.state,
      languages: Array.isArray(upstream.languages) ? upstream.languages : [],
      sampleFileName: sample.name.slice(0, 200),
      consentConfirmedAt: new Date(),
      lastStatusCheckedAt: new Date(),
    });
    createdVoiceId = "";
    return Response.json({ success: true, voice: serializeVoice(record) }, { status: 201 });
  } catch (error) {
    if (createdVoiceId) await deleteQwenVoice(createdVoiceId).catch((cleanupError) => {
      console.error("[Qwen Audio] cleanup unpersisted voice:", cleanupError);
    });
    return Response.json({ success: false, message: qwenPublicMessage(error, "声音复刻失败") }, { status: qwenErrorStatus(error) });
  } finally {
    if (creationLease) await releaseVoiceCreationLease(creationLease).catch((error) => { console.error("[Qwen Audio] release voice lease:", error); });
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[Qwen Audio] release media lease:", error); });
  }
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
