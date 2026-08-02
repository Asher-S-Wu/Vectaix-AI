import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import {
  VIDEO_SOURCE_TOKEN_PATTERN,
  videoSourceTokensMatch,
} from "@/lib/media/server/happyhorse/sourceAccess";
import {
  createStoredFileReadStream,
  findOwnedStoredFile,
  getStoredFileAbsolutePath,
  normalizeFileId,
} from "@/lib/server/storage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_ACCESS_RATE_LIMIT = Object.freeze({ limit: 240, windowMs: 15 * 60 * 1000 });
const SOURCE_ACCESS_IP_RATE_LIMIT = Object.freeze({ limit: 600, windowMs: 15 * 60 * 1000 });

function notFound() {
  return Response.json(
    { success: false, message: "素材链接无效或已过期" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || "").trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end === null) return null;
  if (start === null) {
    const suffixLength = Math.min(end, size);
    start = size - suffixLength;
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || start > end
    || start >= size
  ) {
    return null;
  }
  return { start, end };
}

async function serveSource(request, context, headOnly) {
  const params = await context?.params;
  const taskId = typeof params?.taskId === "string" ? params.taskId.trim() : "";
  const fileId = normalizeFileId(params?.fileId);
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!mongoose.isValidObjectId(taskId) || !fileId || !VIDEO_SOURCE_TOKEN_PATTERN.test(token)) {
    return notFound();
  }

  const clientIp = getClientIP(request);
  const ipLimited = rateLimit(
    `media-video-source-access-ip:${clientIp}`,
    SOURCE_ACCESS_IP_RATE_LIMIT,
  );
  if (!ipLimited.success) {
    return Response.json(
      { success: false, message: "素材访问过于频繁" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const limited = rateLimit(
    `media-video-source-access:${taskId}:${clientIp}`,
    SOURCE_ACCESS_RATE_LIMIT,
  );
  if (!limited.success) {
    return Response.json(
      { success: false, message: "素材访问过于频繁" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  await dbConnect();
  const task = await VideoGenerationTask.findOne({
    _id: taskId,
    inputFileIds: fileId,
    sourceAccessTokenExpiresAt: { $gt: new Date() },
    sourceAccessRevokedAt: null,
  })
    .select("userId inputFileIds +sourceAccessTokenHash")
    .lean();
  if (!task || !videoSourceTokensMatch(token, task.sourceAccessTokenHash)) return notFound();

  const file = await findOwnedStoredFile({ userId: task.userId, fileId });
  if (
    !file
    || file.ownerType !== "video-task"
    || file.ownerId !== String(task._id)
    || !["media-image", "media-video"].includes(file.kind)
  ) {
    return notFound();
  }

  try {
    const fileStat = await stat(getStoredFileAbsolutePath(file));
    const size = fileStat.size;
    const requestedRange = request.headers.get("range");
    const range = requestedRange ? parseRange(requestedRange, size) : null;
    if (requestedRange && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          "Cache-Control": "no-store",
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": "inline",
      "Content-Type": file.mimeType || "application/octet-stream",
      "Last-Modified": fileStat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    });
    if (range) {
      const length = range.end - range.start + 1;
      headers.set("Content-Length", String(length));
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      const stream = headOnly ? null : Readable.toWeb(createStoredFileReadStream(file, range));
      return new Response(stream, { status: 206, headers });
    }
    headers.set("Content-Length", String(size));
    const stream = headOnly ? null : Readable.toWeb(createStoredFileReadStream(file));
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    console.error("[Media Video] serve source:", error);
    return Response.json(
      { success: false, message: "读取素材失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function GET(request, context) {
  return serveSource(request, context, false);
}

export function HEAD(request, context) {
  return serveSource(request, context, true);
}
