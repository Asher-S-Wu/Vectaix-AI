import { modelAccessResponse } from "@/lib/server/guest/access";
import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import { AUDIO_UPLOAD_PURPOSES } from "@/lib/media/shared/audioUploads";
import {
  DOUBAO_AUDIO_MODEL,
  DOUBAO_CUSTOM_VOICE_MAX_COUNT,
  DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";
import {
  claimAudioSources,
  deleteClaimedAudioSources,
  getAudioSourceAbsolutePath,
} from "@/lib/media/server/audioSourceUploads";
import { transcodeAudioClip } from "@/lib/media/server/audioTranscoding";
import { serializeDoubaoVoice } from "@/lib/media/server/doubaoAudioRecords";
import {
  acquireVoiceCreationLease,
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
  releaseVoiceCreationLease,
} from "@/lib/media/server/userOperationLeases";
import {
  createStoredFile,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";
import DoubaoVoice from "@/models/DoubaoVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_LIST_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60 * 1000 });
const VOICE_MUTATION_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 10 * 60 * 1000 });
const MAX_JSON_BYTES = 32 * 1024;

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function errorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DOUBAO_AUDIO_API_KEY")) return "豆包音频服务密钥尚未配置";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function parseCreateInput(body) {
  const input = {
    displayName: typeof body?.displayName === "string" ? body.displayName.trim() : "",
    sampleUploadId: typeof body?.sampleUploadId === "string" ? body.sampleUploadId.trim() : "",
    clipStart: readNumber(body?.clipStart),
    clipEnd: readNumber(body?.clipEnd),
    consent: body?.consent === true,
  };
  if (!input.displayName) throw Object.assign(new Error("请填写声音名称"), { status: 400 });
  if (input.displayName.length > DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH) {
    throw Object.assign(
      new Error(`声音名称最多支持 ${DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH} 个字符`),
      { status: 400 },
    );
  }
  if (!input.sampleUploadId) throw Object.assign(new Error("请上传参考声音"), { status: 400 });
  if (!Number.isFinite(input.clipStart) || !Number.isFinite(input.clipEnd)) {
    throw Object.assign(new Error("参考声音片段无效"), { status: 400 });
  }
  if (!input.consent) {
    throw Object.assign(new Error("请确认你有权使用这段声音"), { status: 400 });
  }
  return input;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-doubao-voice-list:${user.userId}:${getClientIP(request)}`,
      VOICE_LIST_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("声音列表读取过于频繁，请稍后再试", 429);
    const voices = await DoubaoVoice.find({
      userId: user.userId,
      model: DOUBAO_AUDIO_MODEL,
      status: "READY",
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(DOUBAO_CUSTOM_VOICE_MAX_COUNT)
      .lean();
    return Response.json({
      success: true,
      voices: voices.map(serializeDoubaoVoice).filter(Boolean),
    });
  } catch (error) {
    console.error("[Doubao Audio] list voices:", error);
    return jsonMessage(publicMessage(error, "读取豆包声音失败"), errorStatus(error));
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  let voiceCreationLease = null;
  let sourceOperationId = "";
  let profileId = "";
  let userId = "";
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const accessError = modelAccessResponse(user, DOUBAO_AUDIO_MODEL);
    if (accessError) return accessError;
    userId = user.userId;
    const limited = rateLimit(
      `media-doubao-voice-mutation:${userId}:${getClientIP(request)}`,
      VOICE_MUTATION_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("声音库操作过于频繁，请稍后再试", 429);
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) {
      return parsed.response.status === 413
        ? jsonMessage("请求内容过大", 413)
        : parsed.response;
    }
    const input = parseCreateInput(parsed.body);

    mediaWriteLease = await beginMediaWriteLease(userId);
    voiceCreationLease = await acquireVoiceCreationLease(userId);
    const existingCount = await DoubaoVoice.countDocuments({
      userId,
      model: DOUBAO_AUDIO_MODEL,
    });
    if (existingCount >= DOUBAO_CUSTOM_VOICE_MAX_COUNT) {
      return jsonMessage(`每位用户最多保存 ${DOUBAO_CUSTOM_VOICE_MAX_COUNT} 个豆包参考声音`, 409);
    }

    sourceOperationId = crypto.randomUUID();
    const [source] = await claimAudioSources({
      userId,
      fileIds: [input.sampleUploadId],
      purpose: AUDIO_UPLOAD_PURPOSES.DOUBAO_VOICE_LIBRARY,
      operationId: sourceOperationId,
    });
    const normalized = await transcodeAudioClip({
      inputPath: getAudioSourceAbsolutePath(source),
      purpose: AUDIO_UPLOAD_PURPOSES.DOUBAO_VOICE_LIBRARY,
      clipStart: input.clipStart,
      clipEnd: input.clipEnd,
      sourceMetadata: {
        duration: source.audioDuration,
        channels: source.audioChannels,
        sampleRate: source.audioSampleRate,
      },
      signal: request.signal,
    });

    profileId = crypto.randomUUID();
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const sample = await createStoredFile({
      userId,
      input: normalized.buffer,
      originalName: `doubao-voice-reference-${profileId}.wav`,
      mimeType: normalized.mimeType,
      extension: normalized.extension,
      category: "audio",
      kind: "doubao-voice-reference",
      ownerType: "voice-profile",
      ownerId: profileId,
      mediaWriteLease,
    });
    let voice;
    try {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      voice = await DoubaoVoice.create({
        profileId,
        userId,
        displayName: input.displayName,
        model: DOUBAO_AUDIO_MODEL,
        status: "READY",
        sampleFileId: sample.fileId,
        sampleFileName: source.originalName,
        duration: normalized.duration,
        sampleRate: normalized.sampleRate,
        size: sample.size,
        consentConfirmedAt: new Date(),
      });
    } catch (error) {
      await deleteStoredFilesByOwner({
        userId,
        ownerType: "voice-profile",
        ownerId: profileId,
      });
      throw error;
    }

    return Response.json({
      success: true,
      voice: serializeDoubaoVoice(voice),
    }, { status: 201 });
  } catch (error) {
    if (profileId && userId) {
      await DoubaoVoice.deleteOne({
        userId,
        profileId,
        model: DOUBAO_AUDIO_MODEL,
      }).catch(() => {});
      await deleteStoredFilesByOwner({
        userId,
        ownerType: "voice-profile",
        ownerId: profileId,
      }).catch(() => {});
    }
    console.error("[Doubao Audio] create voice:", error);
    return jsonMessage(publicMessage(error, "保存豆包参考声音失败"), errorStatus(error));
  } finally {
    if (sourceOperationId && userId) {
      await deleteClaimedAudioSources({ userId, operationId: sourceOperationId }).catch((error) => {
        console.error("[Doubao Audio] cleanup source upload:", error);
      });
    }
    if (voiceCreationLease) {
      await releaseVoiceCreationLease(voiceCreationLease).catch((error) => {
        console.error("[Doubao Audio] release voice creation lease:", error);
      });
    }
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Doubao Audio] release voice lease:", error);
      });
    }
  }
}
