import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/minimaxAudio";
import {
  deleteMinimaxVoice,
  isMissingMinimaxVoiceError,
} from "@/lib/media/server/minimaxAudio";
import { serializeMinimaxVoice } from "@/lib/media/server/minimaxAudioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { deleteStoredFilesByOwner } from "@/lib/server/storage/service";
import MinimaxVoice from "@/models/MinimaxVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (message.includes("DASHSCOPE_BEIJING_API_KEY")) return "MiniMax 北京区域密钥尚未配置";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

async function readId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

function checkRateLimit(request, userId) {
  return rateLimit(
    `media-minimax-voice-mutation:${userId}:${getClientIP(request)}`,
    VOICE_MUTATION_RATE_LIMIT,
  );
}

export async function PATCH(request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!checkRateLimit(request, user.userId).success) {
      return jsonMessage("音色修改过于频繁，请稍后再试", 429);
    }
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const displayName = typeof parsed.body?.displayName === "string"
      ? parsed.body.displayName.trim()
      : "";
    if (!displayName) return jsonMessage("请填写音色名称");
    if (displayName.length > MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH) {
      return jsonMessage(`音色名称最多支持 ${MINIMAX_VOICE_DISPLAY_NAME_MAX_LENGTH} 个字符`);
    }
    const profileId = await readId(context);
    const voice = await MinimaxVoice.findOneAndUpdate(
      { profileId, userId: user.userId, status: "READY" },
      { $set: { displayName } },
      { new: true },
    );
    if (!voice) return jsonMessage("MiniMax 复刻音色不存在", 404);
    return Response.json({ success: true, voice: serializeMinimaxVoice(voice) });
  } catch (error) {
    console.error("[MiniMax Audio] rename voice:", error);
    return jsonMessage(publicMessage(error, "修改 MiniMax 音色失败"), errorStatus(error));
  }
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!checkRateLimit(request, user.userId).success) {
      return jsonMessage("音色删除过于频繁，请稍后再试", 429);
    }
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const profileId = await readId(context);
    const voice = await MinimaxVoice.findOne({
      profileId,
      userId: user.userId,
      status: "READY",
    });
    if (!voice) return jsonMessage("MiniMax 复刻音色不存在", 404);
    try {
      await deleteMinimaxVoice(voice.voiceId, { signal: request.signal });
    } catch (error) {
      if (!isMissingMinimaxVoiceError(error)) throw error;
    }
    await assertMediaWriteLeaseActive(mediaWriteLease);
    await deleteStoredFilesByOwner({
      userId: user.userId,
      ownerType: "voice-profile",
      ownerId: voice.profileId,
    });
    await MinimaxVoice.deleteOne({ _id: voice._id, userId: user.userId });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[MiniMax Audio] delete voice:", { error, requestId: error?.requestId || "" });
    return jsonMessage(publicMessage(error, "删除 MiniMax 音色失败"), errorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[MiniMax Audio] release voice delete lease:", error);
      });
    }
  }
}
