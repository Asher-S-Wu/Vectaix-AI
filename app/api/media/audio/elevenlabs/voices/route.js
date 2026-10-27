import { localizedRoute } from '@/lib/server/localizedRoute';
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { requireUserRecord, unauthorizedResponse } from "@/lib/server/api/routeHelpers";
import { readMultipart } from "@/lib/server/files/uploads";
import { createElevenLabsVoice, deleteElevenLabsVoice, elevenlabsErrorStatus, elevenlabsPublicMessage, listElevenLabsDefaultVoices, elevenlabsVoiceStatus, elevenlabsVoiceLanguages } from "@/lib/media/server/elevenlabsAudio";
import { serializeVoice } from "@/lib/media/server/audioRecords";
import { inspectAudioMetadata } from "@/lib/media/server/audioSampleInspection";
import { acquireVoiceCreationLease, assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease, releaseVoiceCreationLease } from "@/lib/media/server/userOperationLeases";
import { ELEVENLABS_VOICE_MAX_COUNT, ELEVENLABS_VOICE_SAMPLE_MAX_BYTES, ELEVENLABS_VOICE_SAMPLE_MAX_SECONDS, ELEVENLABS_VOICE_SAMPLE_MIN_SECONDS } from "@/lib/media/shared/elevenlabsAudio";
import ElevenLabsVoice from "@/models/ElevenLabsVoice";
import { getMediaSettings, getSharedAudioVoice } from '@/lib/server/media/settings';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    if (!auth?.payload) return unauthorizedResponse("未登录");
    const voices = await ElevenLabsVoice.find({ userId: auth.payload.userId }).sort({ createdAt: -1 }).lean();
    const sharedId = await getSharedAudioVoice();
    const { audio } = await getMediaSettings();
    const defaults = audio.enabled && audio.hasApiKey ? await listElevenLabsDefaultVoices({ signal: request.signal }) : [];
    const builtin = defaults.filter(voice => !voices.some(item => item.voiceId === voice.voice_id)).map(voice => ({ profileId: `builtin:${voice.voice_id}`, voiceId: voice.voice_id, displayName: voice.name, status: elevenlabsVoiceStatus(voice), languages: elevenlabsVoiceLanguages(voice), builtin: true }));
    const shared = sharedId && !voices.some(voice => voice.voiceId === sharedId) && !builtin.some(voice => voice.voiceId === sharedId)
      ? [{ profileId: `shared:${sharedId}`, voiceId: sharedId, displayName: 'ElevenLabs', status: 'trained', languages: [], shared: true }]
      : [];
    return Response.json({ success: true, voices: [...voices.map(serializeVoice), ...shared, ...builtin] });
  } catch (error) {
    return Response.json({ success: false, message: elevenlabsPublicMessage(error, "读取声音库失败") }, { status: elevenlabsErrorStatus(error) });
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
    if (!rateLimit(`elevenlabs-clone:${userId}:${getClientIP(request)}`, { limit: 5, windowMs: 60000 }).success) {
      return Response.json({ success: false, message: "声音复刻请求较多，请稍后再试" }, { status: 429 });
    }
    const form = await readMultipart(request, ELEVENLABS_VOICE_SAMPLE_MAX_BYTES + 64 * 1024);
    const displayName = typeof form.get("displayName") === "string" ? form.get("displayName").trim() : "";
    if (!displayName || displayName.length > 60) throw Object.assign(new Error("请填写 1 到 60 个字的音色名称"), { status: 400 });
    if (form.get("consentConfirmed") !== "true") throw Object.assign(new Error("请确认拥有声音样本的使用授权"), { status: 400 });
    const sample = form.get("sample");
    if (!(sample instanceof File) || sample.size === 0 || sample.size > ELEVENLABS_VOICE_SAMPLE_MAX_BYTES) {
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
    if (metadata.durationSeconds < ELEVENLABS_VOICE_SAMPLE_MIN_SECONDS || metadata.durationSeconds > ELEVENLABS_VOICE_SAMPLE_MAX_SECONDS) {
      throw Object.assign(new Error("声音样本时长须在 10 秒到 5 分钟之间"), { status: 400 });
    }
    lease = await beginMediaWriteLease(userId);
    creationLease = await acquireVoiceCreationLease(userId);
    if (await ElevenLabsVoice.countDocuments({ userId }) >= ELEVENLABS_VOICE_MAX_COUNT) {
      throw Object.assign(new Error(`最多保存 ${ELEVENLABS_VOICE_MAX_COUNT} 个复刻音色，请先删除闲置音色`), { status: 409 });
    }
    await assertMediaWriteLeaseActive(lease);
    const upstream = await createElevenLabsVoice({ displayName, sample, signal: request.signal });
    createdVoiceId = upstream.voice_id;
    await assertMediaWriteLeaseActive(lease);
    const record = await ElevenLabsVoice.create({
      userId,
      voiceId: upstream.voice_id,
      displayName,
      status: upstream.requires_verification ? "verification_required" : "trained",
      languages: [],
      sampleFileName: sample.name.slice(0, 200),
      consentConfirmedAt: new Date(),
      lastStatusCheckedAt: new Date(),
    });
    createdVoiceId = "";
    return Response.json({ success: true, voice: serializeVoice(record) }, { status: 201 });
  } catch (error) {
    if (createdVoiceId) await deleteElevenLabsVoice(createdVoiceId).catch((cleanupError) => {
      console.error("[ElevenLabs] cleanup unpersisted voice:", cleanupError);
    });
    return Response.json({ success: false, message: elevenlabsPublicMessage(error, "声音复刻失败") }, { status: elevenlabsErrorStatus(error) });
  } finally {
    if (creationLease) await releaseVoiceCreationLease(creationLease).catch((error) => { console.error("[ElevenLabs] release voice lease:", error); });
    if (lease) await endMediaWriteLease(lease).catch((error) => { console.error("[ElevenLabs] release media lease:", error); });
  }
}

export const GET = localizedRoute(GETHandler);
export const POST = localizedRoute(POSTHandler);
