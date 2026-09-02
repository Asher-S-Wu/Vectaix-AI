import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { getFileExtension } from "@/lib/shared/attachments";
import {
  assertRequestSize,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  AUDIO_UPLOAD_EXTENSIONS,
  AUDIO_UPLOAD_MAX_BYTES,
  AUDIO_UPLOAD_RATE_LIMIT,
  AUDIO_UPLOAD_PURPOSES,
} from "@/lib/media/shared/audioUploads";
import {
  cleanupExpiredAudioSourceUploads,
  createAudioSourceUpload,
  isAudioUploadPurpose,
  serializeAudioSource,
} from "@/lib/media/server/audioSourceUploads";
import {
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSION_SET = new Set(AUDIO_UPLOAD_EXTENSIONS);
function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getErrorStatus(error, fallback = 500) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function readOriginalName(request) {
  const encoded = String(request.headers.get("x-file-name") || "").trim();
  if (!encoded) return "";
  try {
    return decodeURIComponent(encoded).trim();
  } catch {
    return "";
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const limited = rateLimit(
      `media-audio-upload:${user.userId}:${getClientIP(request)}`,
      AUDIO_UPLOAD_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("音频上传过于频繁，请稍后再试", 429);

    const sizeError = assertRequestSize(
      request,
      AUDIO_UPLOAD_MAX_BYTES,
      "单个音频不能超过 100MB",
    );
    if (sizeError) return sizeError;
    if (!request.body) return jsonMessage("请选择要上传的音频");

    const purpose = new URL(request.url).searchParams.get("purpose") || "";
    if (!isAudioUploadPurpose(purpose)) return jsonMessage("音频用途无效");
    const originalName = readOriginalName(request);
    if (!originalName) return jsonMessage("音频文件名格式错误");
    const extension = getFileExtension(originalName);
    if (!EXTENSION_SET.has(extension)) {
      return jsonMessage("支持 WAV、MP3、M4A、AAC、FLAC、OGG、Opus 或 WebM 音频");
    }

    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const source = await createAudioSourceUpload({
      userId: user.userId,
      input: request.body,
      originalName,
      extension,
      purpose,
      signal: request.signal,
      mediaWriteLease,
    });
    cleanupExpiredAudioSourceUploads().catch((error) => {
      console.error("[Media Audio] cleanup expired uploads:", error);
    });
    return Response.json({ success: true, upload: serializeAudioSource(source) }, { status: 201 });
  } catch (error) {
    console.error("[Media Audio] upload source:", error);
    return jsonMessage(publicMessage(error, "音频上传或识别失败"), getErrorStatus(error));
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Audio] release upload lease:", error);
      });
    }
  }
}
