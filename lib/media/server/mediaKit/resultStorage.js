import https from "node:https";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { inspectUploadedFile } from "@/lib/server/storage/fileInspection";
import { createStoredFileFromWebStream } from "@/lib/server/storage/service";
import { assertPublicHttpsMediaUrl } from "@/lib/media/server/mediaKit/security";
import { VIDEO_ENHANCEMENT_RESULT_MAX_BYTES } from "@/lib/media/shared/videoEnhancement";

const ACCEPTED_RESULT_MIME_TYPES = new Set([
  "video/mp4",
  "application/mp4",
  "application/octet-stream",
]);
const SIGNATURE_BYTES = 64;
const URL_VALIDATION_TIMEOUT_MS = 30 * 1000;
const RESPONSE_HEADERS_TIMEOUT_MS = 30 * 1000;
const RESPONSE_BODY_IDLE_TIMEOUT_MS = 60 * 1000;
const downloadStreamErrorSymbol = Symbol("downloadStreamError");
const DOWNLOAD_STREAM_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

export class MediaKitResultStorageError extends Error {
  constructor(code) {
    super(code);
    this.name = "MediaKitResultStorageError";
    this.code = code;
  }
}

function createPinnedLookup(address) {
  const family = isIP(address);
  if (!family) throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
  return (_hostname, options, callback) => {
    const lookupOptions = typeof options === "object" && options ? options : {};
    const done = typeof options === "function" ? options : callback;
    if (lookupOptions.all === true) {
      done(null, [{ address, family }]);
      return;
    }
    done(null, address, family);
  };
}

function validateResponseHeaders(response) {
  if (response.statusCode !== 200) {
    throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
  }
  const mimeType = String(response.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!ACCEPTED_RESULT_MIME_TYPES.has(mimeType)) {
    throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
  }
  const rawLength = response.headers["content-length"];
  if (rawLength !== undefined) {
    const normalizedLength = String(rawLength).trim();
    if (!/^[1-9]\d*$/.test(normalizedLength)) {
      throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
    }
    const contentLength = Number(normalizedLength);
    if (!Number.isSafeInteger(contentLength)) {
      throw new MediaKitResultStorageError("RESULT_TOO_LARGE");
    }
    if (contentLength > VIDEO_ENHANCEMENT_RESULT_MAX_BYTES) {
      throw new MediaKitResultStorageError("RESULT_TOO_LARGE");
    }
  }
}

async function validateResultUrlWithinTimeout(videoUrl, signal) {
  if (signal?.aborted) {
    throw signal.reason || new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
  }
  let timeoutTimer = null;
  let abortHandler = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED"));
    }, URL_VALIDATION_TIMEOUT_MS);
    timeoutTimer.unref?.();
  });
  const abortPromise = new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason || new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED"));
      return;
    }
    abortHandler = () => {
      reject(signal.reason || new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED"));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([
      assertPublicHttpsMediaUrl(videoUrl),
      timeoutPromise,
      abortPromise,
    ]);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

async function openPinnedHttpsStream(videoUrl, { signal } = {}) {
  let safeUrl;
  try {
    safeUrl = await validateResultUrlWithinTimeout(videoUrl, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error?.code === "TASK_LEASE_LOST" || error?.name === "UserOperationLeaseError") {
      throw error;
    }
    if (error instanceof MediaKitResultStorageError) throw error;
    throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
  }
  const address = safeUrl.addresses[0];
  const parsed = new URL(safeUrl.url);

  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let headersTimer = null;
      const clearHeadersTimer = () => {
        if (!headersTimer) return;
        clearTimeout(headersTimer);
        headersTimer = null;
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        clearHeadersTimer();
        reject(error);
      };
      const resolveOnce = (stream) => {
        if (settled) return false;
        settled = true;
        clearHeadersTimer();
        resolve(stream);
        return true;
      };
      const request = https.request(parsed, {
        method: "GET",
        agent: false,
        lookup: createPinnedLookup(address),
        servername: safeUrl.hostname,
        signal,
        headers: {
          Accept: "video/mp4, application/mp4, application/octet-stream",
        },
      });
      headersTimer = setTimeout(() => {
        const error = new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
        request.destroy(error);
        rejectOnce(error);
      }, RESPONSE_HEADERS_TIMEOUT_MS);
      headersTimer.unref?.();
      request.once("response", (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        try {
          validateResponseHeaders(response);
          response.setTimeout(RESPONSE_BODY_IDLE_TIMEOUT_MS, () => {
            const error = new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
            error[downloadStreamErrorSymbol] = true;
            response.destroy(error);
          });
          const markDownloadStreamError = (error) => {
            if (error && typeof error === "object") {
              error[downloadStreamErrorSymbol] = true;
            }
          };
          const handleResponseAborted = () => {
            const error = new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
            error[downloadStreamErrorSymbol] = true;
            response.destroy(error);
          };
          const clearBodyTimeout = () => {
            response.setTimeout(0);
            response.removeListener("end", clearBodyTimeout);
            response.removeListener("close", clearBodyTimeout);
            response.removeListener("error", markDownloadStreamError);
            response.removeListener("aborted", handleResponseAborted);
          };
          response.once("end", clearBodyTimeout);
          response.once("close", clearBodyTimeout);
          response.once("error", markDownloadStreamError);
          response.once("aborted", handleResponseAborted);
          if (!resolveOnce(Readable.toWeb(response))) response.destroy();
        } catch (error) {
          response.destroy();
          rejectOnce(error);
        }
      });
      request.once("error", (error) => {
        if (settled) return;
        if (signal?.aborted) {
          rejectOnce(signal.reason || error);
          return;
        }
        rejectOnce(new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED"));
      });
      request.end();
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error instanceof MediaKitResultStorageError) throw error;
    throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
  }
}

async function validateMp4TemporaryFile({ absolutePath }) {
  let fileHandle;
  try {
    fileHandle = await open(absolutePath, "r");
    const signature = Buffer.alloc(SIGNATURE_BYTES);
    const { bytesRead } = await fileHandle.read(signature, 0, SIGNATURE_BYTES, 0);
    const inspected = inspectUploadedFile(signature.subarray(0, bytesRead), "mp4");
    if (inspected?.mimeType !== "video/mp4" || inspected.category !== "video") {
      throw new MediaKitResultStorageError("RESULT_SAVE_FAILED");
    }
  } finally {
    await fileHandle?.close();
  }
}

export async function saveMediaKitVideoEnhancementResult({
  taskId,
  userId,
  videoUrl,
  signal,
  mediaWriteLease,
  assertWriteCommitAllowed,
}) {
  let stored;
  try {
    const input = await openPinnedHttpsStream(videoUrl, { signal });
    stored = await createStoredFileFromWebStream({
      userId,
      input,
      originalName: `AI-MediaKit-enhanced-${String(taskId)}.mp4`,
      mimeType: "video/mp4",
      extension: "mp4",
      category: "video",
      kind: "media-video",
      ownerType: "video-enhancement-task",
      ownerId: taskId,
      maxBytes: VIDEO_ENHANCEMENT_RESULT_MAX_BYTES,
      signal,
      mediaWriteLease,
      assertWriteCommitAllowed,
      validateTemporaryFileBeforeCommit: validateMp4TemporaryFile,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (
      error?.code === "TASK_LEASE_LOST"
      || error?.name === "MediaKitTaskLeaseLostError"
      || error?.name === "UserOperationLeaseError"
    ) {
      throw error;
    }
    if (error instanceof MediaKitResultStorageError) throw error;
    if (error?.status === 413) {
      throw new MediaKitResultStorageError("RESULT_TOO_LARGE");
    }
    if (
      error?.[downloadStreamErrorSymbol]
      || error?.name === "AbortError"
      || DOWNLOAD_STREAM_ERROR_CODES.has(error?.code)
      || DOWNLOAD_STREAM_ERROR_CODES.has(error?.cause?.code)
    ) {
      throw new MediaKitResultStorageError("RESULT_DOWNLOAD_FAILED");
    }
    throw new MediaKitResultStorageError("RESULT_SAVE_FAILED");
  }
  return Object.freeze({
    fileId: stored.fileId,
    size: stored.size,
  });
}
