import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import dbConnect from "@/lib/db";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import { AUDIO_MODEL } from "@/lib/media/shared/models";
import {
  createStoredFileReadStream,
  findOwnedStoredFile,
  getStoredFileAbsolutePath,
} from "@/lib/server/storage/service";
import CustomVoice from "@/models/CustomVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_ACCESS_LIMIT = Object.freeze({ limit: 60, windowMs: 15 * 60 * 1000 });
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function notFound() {
  return Response.json(
    { success: false, message: "声音样本链接无效或已过期" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function tokensMatch(token, expectedHash) {
  const actual = crypto.createHash("sha256").update(token).digest();
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
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

async function serveSample(request, context, headOnly) {
  const params = await context?.params;
  const profileId = typeof params?.profileId === "string" ? params.profileId.trim() : "";
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!PROFILE_ID_PATTERN.test(profileId) || !TOKEN_PATTERN.test(token)) {
    return notFound();
  }

  const limited = rateLimit(
    `media-audio-sample:${profileId}:${getClientIP(request)}`,
    SAMPLE_ACCESS_LIMIT,
  );
  if (!limited.success) {
    return Response.json(
      { success: false, message: "样本访问过于频繁" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  await dbConnect();
  const now = new Date();
  const voice = await CustomVoice.findOne({
    profileId,
    model: AUDIO_MODEL,
    sampleFileId: { $ne: null },
    sampleTokenExpiresAt: { $gt: now },
    sampleExpiresAt: { $gt: now },
  })
    .select("userId sampleFileId +sampleTokenHash")
    .lean();
  if (!voice || !tokensMatch(token, voice.sampleTokenHash)) {
    return notFound();
  }

  const file = await findOwnedStoredFile({
    userId: voice.userId,
    fileId: voice.sampleFileId,
  });
  if (
    !file
    || file.kind !== "voice-sample"
    || file.ownerType !== "voice-profile"
    || file.ownerId !== profileId
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
    console.error("[Media Audio] serve voice sample:", error);
    return Response.json(
      { success: false, message: "读取声音样本失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function GET(request, context) {
  return serveSample(request, context, false);
}

export function HEAD(request, context) {
  return serveSample(request, context, true);
}
