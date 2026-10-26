import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { readMultipart } from "@/lib/server/files/uploads";
import { createFishVoice, deleteFishVoice, fishErrorStatus, fishPublicMessage } from "@/lib/media/server/fishAudio";
import { serializeVoice } from "@/lib/media/server/audioRecords";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";
import { acquireVoiceCreationLease, assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease, releaseVoiceCreationLease } from "@/lib/media/server/userOperationLeases";
import { FISH_VOICE_MAX_COUNT, FISH_VOICE_SAMPLE_MAX_BYTES, FISH_VOICE_SAMPLE_MAX_SECONDS, FISH_VOICE_SAMPLE_MIN_SECONDS } from "@/lib/media/shared/fishAudio";
import FishVoice from "@/models/FishVoice";
import { getSharedAudioVoice } from '@/lib/server/media/settings';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const voices = await FishVoice.find({ userId: auth.payload.userId }).sort({ createdAt: -1 }).lean();
    const sharedId = await getSharedAudioVoice('fish');
    const shared = sharedId && !voices.some(voice => voice.voiceId === sharedId)
      ? [{ profileId: `shared:${sharedId}`, voiceId: sharedId, displayName: 'Fish Audio', status: 'trained', languages: [], shared: true }]
      : [];
    return Response.json({ success: true, voices: [...voices.map(serializeVoice), ...shared] });
  } catch (error) {
    return Response.json({ success: false, message: fishPublicMessage(error, "读取声音库失败") }, { status: fishErrorStatus(error) });
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
    if (!rateLimit(`fish-clone:${userId}:${getClientIP(request)}`, { limit: 5, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "声音复刻请求较多，请稍后再试" }, { status: 429 });
    }
    const form = await readMultipart(request, FISH_VOICE_SAMPLE_MAX_BYTES + 64 * 1024);
    const displayName = typeof form.get("displayName") === "string" ? form.get("displayName").trim() : "";
    if (!displayName || displayName.length > 60) throw Object.assign(new Error("请填写 1 到 60 个字的音色名称"), { status: 400 });
    if (form.get("consentConfirmed") !== "true") throw Object.assign(new Error("请确认拥有声音样本的使用授权"), { status: 400 });
    const sample = form.get("sample");
    if (!(sample instanceof File) || sample.size === 0 || sample.size > FISH_VOICE_SAMPLE_MAX_BYTES) {
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
    if (metadata.durationSeconds < FISH_VOICE_SAMPLE_MIN_SECONDS || metadata.durationSeconds > FISH_VOICE_SAMPLE_MAX_SECONDS) {
      throw Object.assign(new Error("声音样本时长须在 10 秒到 5 分钟之间"), { status: 400 });
    }
    lease = await beginMediaWriteLease(userId);
    creationLease = await acquireVoiceCreationLease(userId);
    if (await FishVoice.countDocuments({ userId }) >= FISH_VOICE_MAX_COUNT) {
      throw Object.assign(new Error(`最多保存 ${FISH_VOICE_MAX_COUNT} 个复刻音色，请先删除闲置音色`), { status: 409 });
    }
    await assertMediaWriteLeaseActive(lease);
    const upstream = await createFishVoice({ displayName, sample, signal: request.signal });
    createdVoiceId = upstream._id;
    await assertMediaWriteLeaseActive(lease);
    const record = await FishVoice.create({
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
    if (createdVoiceId) await deleteFishVoice(createdVoiceId).catch((cleanupError) => {
      console.error("[Fish Audio] cleanup unpersisted voice:", cleanupError);
    });
    return Response.json({ success: false, message: fishPublicMessage(error, "声音复刻失败") }, { status: fishErrorStatus(error) });
  } finally {
    if (creationLease) await releaseVoiceCreationLease(creationLease).catch((error) => { console.error("[Fish Audio] release voice lease:", error); });
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[Fish Audio] release media lease:", error); });
  }
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
