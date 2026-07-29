import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  getModelConfig,
  isImageGenerationModel,
  isMediaGenerationModel,
  isVideoGenerationModel,
} from "@/lib/shared/models";
import {
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_MODEL_NAME,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FRAME_ACCEPTED_MIME_TYPES,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_MODEL_NAME,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
} from "@/lib/media/shared/models";
import {
  editAndStoreImageFile,
  generateAndStoreImageFile,
} from "@/lib/media/server/inferera/images";
import {
  createUpstreamVideoTask,
  deleteUpstreamVideoTask,
  getUpstreamVideoTask,
  storeUpstreamConversationVideoOutput,
} from "@/lib/media/server/inferera/videos";
import {
  isNonEmptyString,
  generateMessageId,
  sanitizeStoredMessagesStrict,
} from "@/app/api/chat/utils";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
  loadConversationForRoute,
  rollbackConversationTurn,
} from "@/app/api/chat/conversationState";
import {
  bindStoredFiles,
  collectStoredFileIds,
  deleteStoredFilesByIds,
  findOwnedStoredFile,
  readStoredFileBuffer,
  serializeStoredFile,
} from "@/lib/server/storage/service";
import {
  CHAT_RATE_LIMIT,
  HEARTBEAT_INTERVAL_MS,
  MAX_REQUEST_BYTES,
  SSE_PADDING,
} from "@/lib/server/chat/routeConstants";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_MAX_POLL_ITERATIONS = 300;
const IMAGE_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((option) => option.id));
const VIDEO_RATIOS = new Set(VIDEO_ASPECT_RATIO_OPTIONS.map((option) => option.id));
const VIDEO_DURATIONS = new Set(VIDEO_DURATION_OPTIONS.map((option) => option.id));
const VIDEO_RESOLUTIONS = new Set(VIDEO_RESOLUTION_OPTIONS.map((option) => option.id));
const IMAGE_REFERENCE_MIME_TYPES = new Set(IMAGE_EDIT_ACCEPTED_MIME_TYPES);
const VIDEO_REFERENCE_MIME_TYPES = new Set(VIDEO_FRAME_ACCEPTED_MIME_TYPES);

function createHttpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readAllowedOption(value, allowed, defaultValue, errorMessage) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (!allowed.has(value)) throw createHttpError(errorMessage);
  return value;
}

function normalizeMediaOptions(model, value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (isImageGenerationModel(model)) {
    return {
      size: readAllowedOption(input.size, IMAGE_SIZES, "1024x1024", "不支持的图片尺寸"),
    };
  }
  if (isVideoGenerationModel(model)) {
    const duration = input.duration === undefined || input.duration === null || input.duration === ""
      ? 5
      : Number(input.duration);
    if (!VIDEO_DURATIONS.has(duration)) throw createHttpError("不支持的视频时长");
    return {
      ratio: readAllowedOption(input.ratio, VIDEO_RATIOS, "adaptive", "不支持的画面比例"),
      duration,
      resolution: readAllowedOption(input.resolution, VIDEO_RESOLUTIONS, "720p", "不支持的视频分辨率"),
      generateAudio: input.generateAudio !== false,
      watermark: false,
    };
  }
  throw createHttpError("unsupported model");
}

function getMessagePrompt(message, fallbackPrompt) {
  if (typeof fallbackPrompt === "string" && fallbackPrompt.trim()) return fallbackPrompt.trim();
  if (typeof message?.content === "string" && message.content.trim()) return message.content.trim();
  return (Array.isArray(message?.parts) ? message.parts : [])
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

function getMessageImageFileId(message) {
  for (const part of Array.isArray(message?.parts) ? message.parts : []) {
    if (typeof part?.inlineData?.fileId === "string" && part.inlineData.fileId) {
      return part.inlineData.fileId;
    }
  }
  return "";
}

function validateMediaPrompt(model, prompt, hasReferenceImage) {
  if (isImageGenerationModel(model)) {
    if (!prompt) throw createHttpError("请输入图片描述");
    if (prompt.length > IMAGE_PROMPT_MAX_LENGTH) {
      throw createHttpError(`图片描述最多支持 ${IMAGE_PROMPT_MAX_LENGTH} 个字符`);
    }
    return;
  }
  if (!prompt && !hasReferenceImage) {
    throw createHttpError("请输入视频描述或上传参考图片");
  }
  if (prompt.length > VIDEO_PROMPT_MAX_LENGTH) {
    throw createHttpError(`视频描述最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符`);
  }
}

async function loadReferenceImage({ userId, fileId, acceptedMimeTypes, maxBytes }) {
  if (!fileId) return null;
  const stored = await findOwnedStoredFile({ userId, fileId });
  if (!stored) throw createHttpError("参考图片不存在或无权访问", 404);
  if (stored.category !== "image" || !acceptedMimeTypes.has(stored.mimeType)) {
    throw createHttpError("参考图片仅支持 PNG、JPG、WEBP");
  }
  if (stored.size <= 0 || stored.size > maxBytes) {
    throw createHttpError("参考图片大小不能超过 25MB");
  }
  const buffer = await readStoredFileBuffer(stored);
  return new File([buffer], stored.originalName, { type: stored.mimeType });
}

function waitForVideoPoll(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, VIDEO_POLL_INTERVAL_MS);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

export async function POST(req) {
  let writePermitTime = null;
  let mediaWriteLease = null;
  let mediaWriteLeaseTransferred = false;
  let mediaWriteLeaseReleased = false;

  const releaseMediaWriteLease = async () => {
    if (!mediaWriteLease || mediaWriteLeaseReleased) return;
    mediaWriteLeaseReleased = true;
    await endMediaWriteLease(mediaWriteLease).catch((error) => {
      console.error("[Media Chat] release media write lease:", error);
    });
  };

  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const {
      prompt,
      model,
      config,
      history,
      conversationId,
      mode,
      messages,
      userMessageId,
      modelMessageId,
    } = body;

    if (!isMediaGenerationModel(model)) {
      return Response.json({ error: "unsupported model" }, { status: 400 });
    }
    if (typeof prompt !== "string") {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }

    const auth = await getAuthPayload();
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIP = getClientIP(req);
    const rateLimitKey = `chat-media:${auth.userId}:${clientIP}`;
    const { success, resetTime } = rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
    if (!success) {
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      return Response.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(retryAfter), "X-RateLimit-Remaining": "0" } }
      );
    }

    await dbConnect();
    const user = await User.findById(auth.userId).select("_id").lean();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    mediaWriteLease = await beginMediaWriteLease(auth.userId);

    let currentConversationId = conversationId || null;
    let currentConversation = await loadConversationForRoute({
      conversationId: currentConversationId,
      userId: auth.userId,
      expectedProvider: getModelConfig(model)?.provider,
    });
    let createdConversationForRequest = false;
    const previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
    const previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
    const isRegenerateMode = mode === "regenerate" && currentConversationId && Array.isArray(messages);
    const resolvedUserMessageId = isNonEmptyString(userMessageId) ? userMessageId.trim() : generateMessageId();
    const resolvedModelMessageId = isNonEmptyString(modelMessageId) ? modelMessageId.trim() : generateMessageId();
    let newlyBoundFileIds = [];
    let removedFileIdsAfterRegenerate = [];
    let currentUserMessage = null;
    let mediaOptions = null;

    if (isRegenerateMode) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const sanitized = sanitizeStoredMessagesStrict(messages);
      currentUserMessage = sanitized[sanitized.length - 1];
      if (currentUserMessage?.role !== "user") {
        throw createHttpError("重新生成缺少用户消息");
      }
      const regeneratedPrompt = getMessagePrompt(currentUserMessage, prompt);
      const regeneratedImageId = getMessageImageFileId(currentUserMessage);
      validateMediaPrompt(model, regeneratedPrompt, Boolean(regeneratedImageId));
      const reboundFiles = await bindStoredFiles({
        userId: auth.userId,
        fileIds: collectStoredFileIds(sanitized),
        ownerType: "conversation",
        ownerId: currentConversationId,
      });
      newlyBoundFileIds = reboundFiles
        .filter((file) => file.ownerType === "temporary")
        .map((file) => file.fileId);
      const nextFileIds = new Set(collectStoredFileIds(sanitized));
      removedFileIdsAfterRegenerate = collectStoredFileIds(previousMessages)
        .filter((fileId) => !nextFileIds.has(fileId));
      const updatedAt = new Date();
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const updated = await Conversation.findOneAndUpdate(
        { _id: currentConversationId, userId: auth.userId },
        { $set: { messages: sanitized, updatedAt } },
        { new: true }
      ).select("updatedAt");
      if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
      writePermitTime = updated.updatedAt?.getTime?.() ?? updatedAt.getTime();
      mediaOptions = normalizeMediaOptions(model, currentUserMessage?.providerState?.media);
    } else {
      mediaOptions = normalizeMediaOptions(model, config?.media);
      const requestedImage = Array.isArray(config?.images)
        ? config.images.find((item) => isNonEmptyString(item?.fileId))
        : null;
      const promptText = prompt.trim();
      validateMediaPrompt(model, promptText, Boolean(requestedImage));

      if (!currentConversationId) {
        await assertMediaWriteLeaseActive(mediaWriteLease);
        const fallbackTitle = isImageGenerationModel(model) ? "图片生成" : "视频生成";
        const titleSource = promptText || fallbackTitle;
        const title = titleSource.length > 30 ? `${titleSource.slice(0, 30)}…` : titleSource;
        const created = await Conversation.create({
          userId: auth.userId,
          title,
          model,
          messages: [],
        });
        currentConversationId = created._id.toString();
        currentConversation = created.toObject();
        createdConversationForRequest = true;
      }

      let storedReference = null;
      if (requestedImage) {
        await assertMediaWriteLeaseActive(mediaWriteLease);
        const boundFiles = await bindStoredFiles({
          userId: auth.userId,
          fileIds: [requestedImage.fileId],
          ownerType: "conversation",
          ownerId: currentConversationId,
        });
        newlyBoundFileIds = boundFiles
          .filter((file) => file.ownerType === "temporary")
          .map((file) => file.fileId);
        storedReference = serializeStoredFile(boundFiles[0]);
        if (!storedReference || storedReference.category !== "image") {
          throw createHttpError("媒体模型仅支持图片作为参考附件");
        }
      }

      const parts = [];
      if (promptText) parts.push({ text: promptText });
      if (storedReference) {
        parts.push({
          inlineData: {
            fileId: storedReference.fileId,
            url: storedReference.url,
            mimeType: storedReference.mimeType,
          },
        });
      }
      currentUserMessage = {
        id: resolvedUserMessageId,
        role: "user",
        content: promptText,
        type: "parts",
        parts,
        providerState: { media: mediaOptions },
      };
      const updatedAt = new Date();
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const updated = await Conversation.findOneAndUpdate(
        { _id: currentConversationId, userId: auth.userId },
        { $push: { messages: currentUserMessage }, $set: { updatedAt } },
        { new: true }
      ).select("updatedAt");
      if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
      writePermitTime = updated.updatedAt?.getTime?.() ?? updatedAt.getTime();
    }

    const effectivePrompt = getMessagePrompt(currentUserMessage, prompt);
    const referenceFileId = getMessageImageFileId(currentUserMessage);
    validateMediaPrompt(model, effectivePrompt, Boolean(referenceFileId));

    const encoder = new TextEncoder();
    let clientAborted = false;
    const onAbort = () => { clientAborted = true; };
    req.signal?.addEventListener?.("abort", onAbort, { once: true });

    let paddingSent = false;
    let heartbeatTimer = null;
    let upstreamVideoTaskId = "";

    const responseStream = new ReadableStream({
      async start(controller) {
        let finalMessagePersisted = false;
        const generatedFileIds = [];

        const sendEvent = (payload) => {
          if (clientAborted) return;
          const padding = !paddingSent ? SSE_PADDING : "";
          paddingSent = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
        };

        const rollbackCurrentTurn = async () => {
          if (finalMessagePersisted) return;
          await rollbackConversationTurn({
            conversationId: currentConversationId,
            userId: auth.userId,
            createdConversationForRequest,
            isRegenerateMode,
            previousMessages,
            previousUpdatedAt,
            userMessageId: resolvedUserMessageId,
            writePermitTime,
            newlyBoundFileIds: [...newlyBoundFileIds, ...generatedFileIds],
          });
        };

        try {
          heartbeatTimer = setInterval(() => {
            try {
              if (!clientAborted) controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            } catch { }
          }, HEARTBEAT_INTERVAL_MS);

          let modelMessage;
          if (isImageGenerationModel(model)) {
            sendEvent({ type: "image_gen_start" });
            const referenceImage = await loadReferenceImage({
              userId: auth.userId,
              fileId: referenceFileId,
              acceptedMimeTypes: IMAGE_REFERENCE_MIME_TYPES,
              maxBytes: IMAGE_EDIT_MAX_BYTES,
            });
            const saved = referenceImage
              ? await editAndStoreImageFile({
                  userId: auth.userId,
                  prompt: effectivePrompt,
                  image: referenceImage,
                  size: mediaOptions.size,
                  ownerType: "conversation",
                  ownerId: currentConversationId,
                  signal: req.signal,
                  mediaWriteLease,
                })
              : await generateAndStoreImageFile({
                  userId: auth.userId,
                  prompt: effectivePrompt,
                  size: mediaOptions.size,
                  ownerType: "conversation",
                  ownerId: currentConversationId,
                  signal: req.signal,
                  mediaWriteLease,
                });
            generatedFileIds.push(saved.fileId);
            modelMessage = {
              id: resolvedModelMessageId,
              role: "model",
              model,
              content: "",
              type: "parts",
              parts: [{
                inlineData: {
                  fileId: saved.fileId,
                  url: saved.url,
                  mimeType: saved.mimeType,
                },
              }],
              providerState: { media: { type: "image", model: IMAGE_MODEL_NAME, options: mediaOptions } },
            };
          } else {
            sendEvent({ type: "video_gen_start" });
            const referenceImage = await loadReferenceImage({
              userId: auth.userId,
              fileId: referenceFileId,
              acceptedMimeTypes: VIDEO_REFERENCE_MIME_TYPES,
              maxBytes: VIDEO_FRAME_MAX_BYTES,
            });
            await assertMediaWriteLeaseActive(mediaWriteLease);
            const upstreamTask = await createUpstreamVideoTask({
              prompt: effectivePrompt,
              image: referenceImage,
              ...mediaOptions,
              signal: req.signal,
            });
            upstreamVideoTaskId = typeof upstreamTask?.id === "string" ? upstreamTask.id.trim() : "";
            if (!upstreamVideoTaskId) throw new Error("视频生成任务提交失败");

            let completedTask = upstreamTask;
            for (let iteration = 0; iteration < VIDEO_MAX_POLL_ITERATIONS; iteration += 1) {
              const status = completedTask?.status;
              if (status === "completed") break;
              if (status === "failed") {
                throw new Error(completedTask?.error?.message || "视频生成失败");
              }
              const progress = Number(completedTask?.progress);
              sendEvent({
                type: "video_gen_progress",
                progress: Number.isFinite(progress) ? progress : 0,
              });
              await waitForVideoPoll(req.signal);
              completedTask = await getUpstreamVideoTask(upstreamVideoTaskId, { signal: req.signal });
            }
            if (completedTask?.status !== "completed") {
              throw new Error("视频生成超时");
            }

            const saved = await storeUpstreamConversationVideoOutput(upstreamVideoTaskId, {
              userId: auth.userId,
              conversationId: currentConversationId,
              signal: req.signal,
              mediaWriteLease,
            });
            generatedFileIds.push(saved.fileId);
            modelMessage = {
              id: resolvedModelMessageId,
              role: "model",
              model,
              content: "",
              type: "parts",
              parts: [{ fileData: serializeStoredFile(saved.storedFile) }],
              providerState: {
                media: {
                  type: "video",
                  model: VIDEO_MODEL_NAME,
                  options: mediaOptions,
                  upstreamTaskId: upstreamVideoTaskId,
                },
              },
            };
          }

          if (clientAborted) {
            await rollbackCurrentTurn();
            try { controller.close(); } catch { }
            return;
          }

          await assertMediaWriteLeaseActive(mediaWriteLease);
          const persisted = await Conversation.findOneAndUpdate(
            buildConversationWriteCondition(currentConversationId, auth.userId, writePermitTime),
            { $push: { messages: modelMessage }, $set: { updatedAt: new Date() } },
            { new: true }
          ).select("updatedAt");
          if (!persisted) {
            throw createHttpError(CONVERSATION_WRITE_CONFLICT_ERROR, 409);
          }
          finalMessagePersisted = true;

          if (removedFileIdsAfterRegenerate.length > 0) {
            await deleteStoredFilesByIds({
              userId: auth.userId,
              fileIds: removedFileIdsAfterRegenerate,
              ownerType: "conversation",
              ownerId: currentConversationId,
            });
          }

          sendEvent({
            type: isImageGenerationModel(model) ? "image_gen_complete" : "video_gen_complete",
            parts: modelMessage.parts,
            providerState: modelMessage.providerState,
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          if (upstreamVideoTaskId) {
            try {
              await deleteUpstreamVideoTask(upstreamVideoTaskId, { signal: undefined });
            } catch { }
          }
          try { await rollbackCurrentTurn(); } catch { }
          if (clientAborted || error?.name === "AbortError") {
            try { controller.close(); } catch { }
            return;
          }
          try {
            sendEvent({ type: "stream_error", message: error?.message || "媒体生成失败" });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            controller.error(error);
          }
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          req.signal?.removeEventListener?.("abort", onAbort);
          await releaseMediaWriteLease();
        }
      },
    });
    mediaWriteLeaseTransferred = true;

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": currentConversationId,
      },
    });
  } catch (error) {
    console.error("[Media Chat] request failed:", {
      name: error?.name || "Error",
      status: error?.status,
    });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return Response.json({ error: error?.message || "媒体生成失败" }, { status });
  } finally {
    if (!mediaWriteLeaseTransferred) {
      await releaseMediaWriteLease();
    }
  }
}
