import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  DOUBAO_AUDIO_MODEL,
  DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/media/shared/doubaoAudio";
import { serializeDoubaoVoice } from "@/lib/media/server/doubaoAudioRecords";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";
import { deleteStoredFileDocument } from "@/lib/server/storage/service";
import DoubaoVoice from "@/models/DoubaoVoice";
import StoredFile from "@/models/StoredFile";

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
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

async function readProfileId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

function checkRateLimit(request, userId) {
  return rateLimit(
    `media-doubao-voice-mutation:${userId}:${getClientIP(request)}`,
    VOICE_MUTATION_RATE_LIMIT,
  );
}

export async function PATCH(request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!checkRateLimit(request, user.userId).success) {
      return jsonMessage("声音修改过于频繁，请稍后再试", 429);
    }
    const parsed = await parseJsonRequest(request, "请求内容格式错误", MAX_JSON_BYTES);
    if (!parsed.ok) {
      return parsed.response.status === 413
        ? jsonMessage("请求内容过大", 413)
        : parsed.response;
    }
    const displayName = typeof parsed.body?.displayName === "string"
      ? parsed.body.displayName.trim()
      : "";
    if (!displayName) return jsonMessage("请填写声音名称");
    if (displayName.length > DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH) {
      return jsonMessage(`声音名称最多支持 ${DOUBAO_VOICE_DISPLAY_NAME_MAX_LENGTH} 个字符`);
    }
    const profileId = await readProfileId(context);
    const voice = await DoubaoVoice.findOneAndUpdate(
      {
        userId: user.userId,
        profileId,
        model: DOUBAO_AUDIO_MODEL,
        status: "READY",
      },
      { $set: { displayName } },
      { new: true },
    );
    if (!voice) return jsonMessage("豆包参考声音不存在", 404);
    return Response.json({ success: true, voice: serializeDoubaoVoice(voice) });
  } catch (error) {
    console.error("[Doubao Audio] rename voice:", error);
    return jsonMessage(publicMessage(error, "修改豆包参考声音失败"), errorStatus(error));
  }
}

export async function DELETE(request, context) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    if (!checkRateLimit(request, user.userId).success) {
      return jsonMessage("声音删除过于频繁，请稍后再试", 429);
    }
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const profileId = await readProfileId(context);
    const voice = await DoubaoVoice.findOneAndUpdate(
      {
        userId: user.userId,
        profileId,
        model: DOUBAO_AUDIO_MODEL,
        status: { $in: ["READY", "DELETING"] },
      },
      { $set: { status: "DELETING" } },
      { new: true },
    );
    if (!voice) return jsonMessage("豆包参考声音不存在", 404);
    await assertMediaWriteLeaseActive(mediaWriteLease);
    const sample = await StoredFile.findOne({
      userId: user.userId,
      fileId: voice.sampleFileId,
      kind: "doubao-voice-reference",
      ownerType: "voice-profile",
      ownerId: voice.profileId,
    });
    if (sample) await deleteStoredFileDocument(sample);
    await DoubaoVoice.deleteOne({
      _id: voice._id,
      userId: user.userId,
      profileId: voice.profileId,
      model: DOUBAO_AUDIO_MODEL,
      status: "DELETING",
    });
    return Response.json({ success: true, deleted: true });
  } catch (error) {
    console.error("[Doubao Audio] delete voice:", error);
    return jsonMessage(publicMessage(error, "删除豆包参考声音失败"), errorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Doubao Audio] release voice delete lease:", error);
      });
    }
  }
}
