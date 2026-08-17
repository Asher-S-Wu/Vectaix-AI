import crypto from "node:crypto";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { resolvePublicAppUrl } from "@/lib/modelRoutes";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  AUDIO_UPLOAD_PURPOSES,
} from "@/lib/media/shared/audioUploads";
import {
  MINIMAX_AUDIO_LANGUAGE_IDS,
  MINIMAX_AUDIO_MODEL_IDS,
  MINIMAX_CUSTOM_VOICE_MAX_COUNT,
  MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH,
  MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";
import {
  claimAudioSources,
  deleteClaimedAudioSources,
  getAudioSourceAbsolutePath,
} from "@/lib/media/server/audioSourceUploads";
import { transcodeAudioClip } from "@/lib/media/server/audioTranscoding";
import {
  createMinimaxVoice,
  deleteMinimaxVoice,
  listMinimaxSystemVoices,
} from "@/lib/media/server/minimaxAudio";
import { serializeMinimaxVoice } from "@/lib/media/server/minimaxAudioRecords";
import {
  acquireVoiceCreationLease,
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
  releaseVoiceCreationLease,
} from "@/lib/media/server/userOperationLeases";
import { saveAudioFromUrl } from "@/lib/media/storage";
import {
  createStoredFile,
  deleteStoredFilesByIds,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";
import MinimaxVoice from "@/models/MinimaxVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_LIST_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 60 * 1000 });
const VOICE_MUTATION_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 10 * 60 * 1000 });
const MAX_JSON_BYTES = 32 * 1024;
const SAMPLE_TOKEN_TTL_MS = 15 * 60 * 1000;
const ALLOWED_MODELS = new Set(MINIMAX_AUDIO_MODEL_IDS);
const ALLOWED_LANGUAGES = new Set(MINIMAX_AUDIO_LANGUAGE_IDS);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function errorStatus(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("DASHSCOPE_BEIJING_API_KEY")) return "MiniMax 北京区域密钥尚未配置";
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
    demoText: typeof body?.demoText === "string" ? body.demoText.trim() : "",
    model: typeof body?.model === "string" ? body.model.trim() : "",
    languageBoost: typeof body?.languageBoost === "string" ? body.languageBoost.trim() : "",
    noiseReduction: body?.noiseReduction === true,
    volumeNormalization: body?.volumeNormalization === true,
    consent: body?.consent === true,
  };
  if (!input.displayName) throw Object.assign(new Error("请填写音色名称"), { status: 400 });
  if (input.displayName.length > MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH) {
    throw Object.assign(new Error(`音色名称最多支持 ${MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH} 个字符`), { status: 400 });
  }
  if (!input.sampleUploadId) throw Object.assign(new Error("请上传声音样本"), { status: 400 });
  if (!Number.isFinite(input.clipStart) || !Number.isFinite(input.clipEnd)) {
    throw Object.assign(new Error("声音样本片段无效"), { status: 400 });
  }
  if (!input.demoText) throw Object.assign(new Error("请填写试听文案"), { status: 400 });
  if (input.demoText.length > MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH) {
    throw Object.assign(new Error(`试听文案最多支持 ${MINIMAX_VOICE_DEMO_TEXT_MAX_LENGTH} 个字符`), { status: 400 });
  }
  if (!ALLOWED_MODELS.has(input.model)) throw Object.assign(new Error("不支持的 MiniMax 模型"), { status: 400 });
  if (!ALLOWED_LANGUAGES.has(input.languageBoost)) throw Object.assign(new Error("不支持的语言增强选项"), { status: 400 });
  if (!input.consent) throw Object.assign(new Error("请确认你有权使用这段声音进行复刻"), { status: 400 });
  return input;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createVoiceId() {
  return `vectaix-${crypto.randomBytes(16).toString("hex")}`;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-minimax-voice-list:${user.userId}:${getClientIP(request)}`,
      VOICE_LIST_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("音色列表读取过于频繁，请稍后再试", 429);
    const [system, custom] = await Promise.all([
      listMinimaxSystemVoices({ signal: request.signal }),
      MinimaxVoice.find({ userId: user.userId, status: "READY" })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MINIMAX_CUSTOM_VOICE_MAX_COUNT)
        .lean(),
    ]);
    return Response.json({
      success: true,
      systemVoices: system.voices,
      customVoices: custom.map(serializeMinimaxVoice).filter(Boolean),
    });
  } catch (error) {
    console.error("[MiniMax Audio] list voices:", error);
    return jsonMessage(publicMessage(error, "读取 MiniMax 音色失败"), errorStatus(error));
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  let voiceCreationLease = null;
  let sourceOperationId = "";
  let profileId = "";
  let remoteVoiceId = "";
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const limited = rateLimit(
      `media-minimax-voice-mutation:${user.userId}:${getClientIP(request)}`,
      VOICE_MUTATION_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("声音复刻操作过于频繁，请稍后再试", 429);
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    voiceCreationLease = await acquireVoiceCreationLease(user.userId);
    const existingCount = await MinimaxVoice.countDocuments({ userId: user.userId });
    if (existingCount >= MINIMAX_CUSTOM_VOICE_MAX_COUNT) {
      return jsonMessage(`每位用户最多保存 ${MINIMAX_CUSTOM_VOICE_MAX_COUNT} 个 MiniMax 复刻音色`, 409);
    }
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const input = parseCreateInput(parsed.body);

    sourceOperationId = crypto.randomUUID();
    const [source] = await claimAudioSources({
      userId: user.userId,
      fileIds: [input.sampleUploadId],
      purpose: AUDIO_UPLOAD_PURPOSES.MINIMAX_VOICE_CLONE,
      operationId: sourceOperationId,
    });
    const normalized = await transcodeAudioClip({
      inputPath: getAudioSourceAbsolutePath(source),
      purpose: AUDIO_UPLOAD_PURPOSES.MINIMAX_VOICE_CLONE,
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
    const voiceId = createVoiceId();
    const token = crypto.randomBytes(32).toString("base64url");
    const sampleTokenExpiresAt = new Date(Date.now() + SAMPLE_TOKEN_TTL_MS);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const sample = await createStoredFile({
      userId: user.userId,
      input: normalized.buffer,
      originalName: `minimax-voice-sample-${profileId}.wav`,
      mimeType: normalized.mimeType,
      extension: normalized.extension,
      category: "audio",
      kind: "voice-sample",
      ownerType: "voice-profile",
      ownerId: profileId,
      mediaWriteLease,
    });
    let voice;
    try {
      voice = await MinimaxVoice.create({
        profileId,
        userId: user.userId,
        displayName: input.displayName,
        voiceId,
        status: "SUBMITTING",
        cloneModel: input.model,
        demoText: input.demoText,
        languageBoost: input.languageBoost || null,
        noiseReduction: input.noiseReduction,
        volumeNormalization: input.volumeNormalization,
        sampleFileId: sample.fileId,
        sampleFileName: source.originalName,
        sampleTokenHash: hashToken(token),
        sampleTokenExpiresAt,
        consentConfirmedAt: new Date(),
      });
    } catch (error) {
      await deleteStoredFilesByOwner({
        userId: user.userId,
        ownerType: "voice-profile",
        ownerId: profileId,
      });
      throw error;
    }

    const publicAppUrl = resolvePublicAppUrl();
    const audioUrl = `${publicAppUrl}/api/media/audio/minimax/voice-samples/${encodeURIComponent(profileId)}?token=${encodeURIComponent(token)}`;
    const upstream = await createMinimaxVoice({
      voiceId,
      audioUrl,
      demoText: input.demoText,
      model: input.model,
      languageBoost: input.languageBoost,
      noiseReduction: input.noiseReduction,
      volumeNormalization: input.volumeNormalization,
    }, { signal: request.signal });
    remoteVoiceId = voiceId;
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const demo = await saveAudioFromUrl({
      userId: user.userId,
      url: upstream.demoAudioUrl,
      format: "mp3",
      ownerId: profileId,
      ownerType: "voice-profile",
      signal: request.signal,
      mediaWriteLease,
    });
    await assertMediaWriteLeaseActive(mediaWriteLease);
    voice = await MinimaxVoice.findOneAndUpdate(
      { profileId, userId: user.userId, status: "SUBMITTING" },
      {
        $set: {
          status: "READY",
          demoFileId: demo.fileId,
          requestId: upstream.requestId,
        },
        $unset: {
          sampleFileId: 1,
          sampleTokenHash: 1,
          sampleTokenExpiresAt: 1,
        },
      },
      { new: true },
    );
    if (!voice) throw new Error("保存 MiniMax 复刻音色失败");
    remoteVoiceId = "";
    await deleteStoredFilesByIds({
      userId: user.userId,
      fileIds: [sample.fileId],
      ownerType: "voice-profile",
      ownerId: profileId,
    });
    return Response.json({ success: true, voice: serializeMinimaxVoice(voice) }, { status: 201 });
  } catch (error) {
    if (remoteVoiceId) {
      await deleteMinimaxVoice(remoteVoiceId).catch((cleanupError) => {
        console.error("[MiniMax Audio] cleanup incomplete remote voice:", cleanupError);
      });
    }
    if (profileId) {
      await MinimaxVoice.deleteOne({ profileId }).catch(() => {});
      await deleteStoredFilesByOwner({
        userId: mediaWriteLease?.userId,
        ownerType: "voice-profile",
        ownerId: profileId,
      }).catch(() => {});
    }
    console.error("[MiniMax Audio] create voice:", { error, requestId: error?.requestId || "" });
    return jsonMessage(publicMessage(error, "MiniMax 声音复刻失败"), errorStatus(error));
  } finally {
    if (sourceOperationId) {
      await deleteClaimedAudioSources({
        userId: mediaWriteLease?.userId,
        operationId: sourceOperationId,
      }).catch((error) => console.error("[MiniMax Audio] cleanup source upload:", error));
    }
    if (voiceCreationLease) {
      await releaseVoiceCreationLease(voiceCreationLease).catch((error) => {
        console.error("[MiniMax Audio] release voice creation lease:", error);
      });
    }
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[MiniMax Audio] release voice lease:", error);
      });
    }
  }
}

