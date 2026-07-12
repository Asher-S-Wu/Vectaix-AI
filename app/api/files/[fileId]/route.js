import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { getAuthPayload } from "@/lib/auth";
import dbConnect from "@/lib/db";
import {
  createStoredFileReadStream,
  deleteOwnedTemporaryFile,
  findOwnedStoredFile,
  getStoredFileAbsolutePath,
  normalizeFileId,
} from "@/lib/server/storage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getOwnedFile(context) {
  const auth = await getAuthPayload();
  if (!auth?.userId) return { error: Response.json({ error: "未登录" }, { status: 401 }) };
  const params = await context.params;
  const fileId = normalizeFileId(params?.fileId);
  if (!fileId) return { error: Response.json({ error: "文件不存在" }, { status: 404 }) };
  await dbConnect();
  const file = await findOwnedStoredFile({ userId: auth.userId, fileId });
  if (!file) return { error: Response.json({ error: "文件不存在" }, { status: 404 }) };
  return { auth, file };
}

function contentDisposition(file, download) {
  const mode = download ? "attachment" : "inline";
  const encoded = encodeURIComponent(String(file.originalName || "file"))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename*=UTF-8''${encoded}`;
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
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

async function serve(request, context, headOnly = false) {
  const owned = await getOwnedFile(context);
  if (owned.error) return owned.error;
  const { file } = owned;
  try {
    const fileStat = await stat(getStoredFileAbsolutePath(file));
    const size = fileStat.size;
    const requestedRange = request.headers.get("range");
    const range = requestedRange ? parseRange(requestedRange, size) : null;
    if (requestedRange && !range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const headers = new Headers({
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(file, new URL(request.url).searchParams.get("download") === "1"),
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Last-Modified": fileStat.mtime.toUTCString(),
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
    console.error("[Storage] serve file:", error);
    return Response.json({ error: "读取文件失败" }, { status: 500 });
  }
}

export function GET(request, context) {
  return serve(request, context, false);
}

export function HEAD(request, context) {
  return serve(request, context, true);
}

export async function DELETE(request, context) {
  const owned = await getOwnedFile(context);
  if (owned.error) return owned.error;
  if (owned.file.ownerType !== "temporary") {
    return Response.json({ error: "已使用的文件不能直接删除" }, { status: 409 });
  }
  await deleteOwnedTemporaryFile({ userId: owned.auth.userId, fileId: owned.file.fileId });
  return Response.json({ success: true });
}
