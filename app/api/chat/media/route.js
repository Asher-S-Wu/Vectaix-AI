import dbConnect from "@/lib/db";
import { billingResult, creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { calculateQwenImageCost } from "@/lib/server/credits/pricing";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
  settleMediaCredits,
} from "@/lib/media/server/billing";
import { requireMediaCreditOperation } from "@/lib/media/server/creditOperation";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  getModelConfig,
  isImageGenerationModel,
} from "@/lib/shared/models";
import {
  IMAGE_EDIT_ACCEPTED_MIME_TYPES,
  IMAGE_EDIT_MAX_BYTES,
  IMAGE_EDIT_MAX_COUNT,
  IMAGE_MODEL_NAME,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_SIZE_OPTIONS,
} from "@/lib/media/shared/models";
import {
  editAndStoreImageFile,
  generateAndStoreImageFile,
  isExplicitQwenImageRejection,
} from "@/lib/media/server/qwenImage";
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

const IMAGE_SIZES = new Set(IMAGE_SIZE_OPTIONS.map((option) => option.id));
const IMAGE_REFERENCE_MIME_TYPES = new Set(IMAGE_EDIT_ACCEPTED_MIME_TYPES);

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

function normalizeImageOptions(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    size: readAllowedOption(input.size, IMAGE_SIZES, "auto", "不支持的图片尺寸"),
  };
}

function getMessagePrompt(message, fallbackPrompt) {
  if (typeof fallbackPrompt === "string" && fallbackPrompt.trim()) return fallbackPrompt.trim();
  if (typeof message?.content === "string" && message.content.trim()) return message.content.trim();
  return (Array.isArray(message?.parts) ? message.parts : [])
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

function getMessageImageFileIds(message) {
  const fileIds = [];
  for (const part of Array.isArray(message?.parts) ? message.parts : []) {
    if (typeof part?.inlineData?.fileId === "string" && part.inlineData.fileId) {
      fileIds.push(part.inlineData.fileId);
    }
  }
  return Array.from(new Set(fileIds));
}

function validateReferenceImageCount(fileIds) {
  if (fileIds.length > IMAGE_EDIT_MAX_COUNT) {
    throw createHttpError(`最多支持 ${IMAGE_EDIT_MAX_COUNT} 张参考图片`);
  }
}

function validateImagePrompt(prompt) {
  if (!prompt) throw createHttpError("请输入图片描述");
  if (prompt.length > IMAGE_PROMPT_MAX_LENGTH) {
    throw createHttpError(`图片描述最多支持 ${IMAGE_PROMPT_MAX_LENGTH} 个字符`);
  }
}

async function loadReferenceImage({ userId, fileId, acceptedMimeTypes, maxBytes }) {
  if (!fileId) return null;
  const stored = await findOwnedStoredFile({ userId, fileId });
  if (!stored) throw createHttpError("参考图片不存在或无权访问", 404);
  if (stored.category !== "image" || !acceptedMimeTypes.has(stored.mimeType)) {
    throw createHttpError("参考图片格式不受支持");
  }
  if (stored.size <= 0 || stored.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw createHttpError(`每张参考图片不能超过 ${maxMb}MB`);
  }
  const buffer = await readStoredFileBuffer(stored);
  return new File([buffer], stored.originalName, { type: stored.mimeType });
}

export async function POST(req) {
  let writePermitTime = null;
  let mediaWriteLease = null;
  let mediaWriteLeaseTransferred = false;
  let mediaWriteLeaseReleased = false;
  let reservation = null;
  let billingOperationId = "";
  let authenticatedUserId = "";
  let preUpstreamBilling = null;

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

    if (!isImageGenerationModel(model)) {
      return Response.json(
        { error: "此接口仅支持图片生成，视频生成请前往视频工作台" },
        { status: 400 }
      );
    }
    if (typeof prompt !== "string") {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }

    const auth = await getAuthPayload(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    authenticatedUserId = auth.userId;

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
    let resolution = "";
    const reserveImageCredits = async (inputImageCount, fingerprintInput) => {
      resolution = mediaOptions.size === "auto" ? "2K" : "1K";
      const feature = inputImageCount ? "qwen_image_edit" : "qwen_image_generate";
      const creditOperation = requireMediaCreditOperation(req, {
        userId: auth.userId,
        feature,
        fingerprintInput,
      });
      billingOperationId = creditOperation.operationId;
      const billingSettings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
      reservation = await reserveMediaCredits({
        operationId: billingOperationId,
        userId: auth.userId,
        feature: inputImageCount ? "qwen_image_edit" : "qwen_image_generate",
        provider: "qwen",
        model: model || IMAGE_MODEL_NAME,
        estimate: calculateQwenImageCost({ resolution, inputImageCount }, billingSettings),
        settings: billingSettings,
        usage: { resolution, inputImageCount },
        executionClaimId: creditOperation.executionClaimId,
        requestFingerprint: creditOperation.requestFingerprint,
      });
    };

    if (isRegenerateMode) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const sanitized = sanitizeStoredMessagesStrict(messages);
      currentUserMessage = sanitized[sanitized.length - 1];
      if (currentUserMessage?.role !== "user") {
        throw createHttpError("重新生成缺少用户消息");
      }
      const regeneratedPrompt = getMessagePrompt(currentUserMessage, prompt);
      const regeneratedImageIds = getMessageImageFileIds(currentUserMessage);
      validateReferenceImageCount(regeneratedImageIds);
      validateImagePrompt(regeneratedPrompt);
      mediaOptions = normalizeImageOptions(currentUserMessage?.providerState?.media);
      await reserveImageCredits(regeneratedImageIds.length, {
        prompt: regeneratedPrompt,
        mediaOptions,
        referenceFileIds: regeneratedImageIds,
        mode: "regenerate",
        conversationId: currentConversationId,
      });
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
      if (!updated) throw createHttpError("Not found", 404);
      writePermitTime = updated.updatedAt?.getTime?.() ?? updatedAt.getTime();
    } else {
      mediaOptions = normalizeImageOptions(config?.media);
      const requestedImages = Array.isArray(config?.images)
        ? config.images.filter((item) => isNonEmptyString(item?.fileId))
        : [];
      const requestedImageIds = Array.from(new Set(
        requestedImages.map((item) => item.fileId.trim())
      ));
      validateReferenceImageCount(requestedImageIds);
      const promptText = prompt.trim();
      validateImagePrompt(promptText);
      await reserveImageCredits(requestedImageIds.length, {
        prompt: promptText,
        mediaOptions,
        referenceFileIds: requestedImageIds,
        mode: "generate",
        conversationId: currentConversationId || "",
      });

      if (!currentConversationId) {
        await assertMediaWriteLeaseActive(mediaWriteLease);
        const fallbackTitle = "图片生成";
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

      let storedReferences = [];
      if (requestedImageIds.length > 0) {
        await assertMediaWriteLeaseActive(mediaWriteLease);
        const boundFiles = await bindStoredFiles({
          userId: auth.userId,
          fileIds: requestedImageIds,
          ownerType: "conversation",
          ownerId: currentConversationId,
        });
        newlyBoundFileIds = boundFiles
          .filter((file) => file.ownerType === "temporary")
          .map((file) => file.fileId);
        const boundById = new Map(
          boundFiles.map((file) => [file.fileId, serializeStoredFile(file)])
        );
        storedReferences = requestedImageIds.map((fileId) => boundById.get(fileId));
        if (storedReferences.some((item) => !item || item.category !== "image")) {
          throw createHttpError("媒体模型仅支持图片作为参考附件");
        }
      }

      const parts = [];
      if (promptText) parts.push({ text: promptText });
      for (const storedReference of storedReferences) {
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
      if (!updated) throw createHttpError("Not found", 404);
      writePermitTime = updated.updatedAt?.getTime?.() ?? updatedAt.getTime();
    }

    const effectivePrompt = getMessagePrompt(currentUserMessage, prompt);
    const referenceFileIds = getMessageImageFileIds(currentUserMessage);
    validateReferenceImageCount(referenceFileIds);
    validateImagePrompt(effectivePrompt);

    const encoder = new TextEncoder();
    let clientAborted = false;
    const onAbort = () => { clientAborted = true; };
    req.signal?.addEventListener?.("abort", onAbort, { once: true });

    let paddingSent = false;
    let heartbeatTimer = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        let finalMessagePersisted = false;
        let billingFinalized = false;
        let requestDispatched = false;
        let upstreamComplete = false;
        let upstreamRequestIds = [];
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

          sendEvent({ type: "image_gen_start" });
          sendEvent({
            type: "credit_reserved",
            billing: billingResult(reservation.transaction, reservation.credit),
          });
          const referenceImages = [];
          for (const fileId of referenceFileIds) {
            referenceImages.push(await loadReferenceImage({
              userId: auth.userId,
              fileId,
              acceptedMimeTypes: IMAGE_REFERENCE_MIME_TYPES,
              maxBytes: IMAGE_EDIT_MAX_BYTES,
            }));
          }
          await assertMediaWriteLeaseActive(mediaWriteLease);
          const billingCallbacks = {
            onRequestDispatched: () => {
              requestDispatched = true;
            },
            onUpstreamComplete: async ({ requestId }) => {
              upstreamComplete = true;
              upstreamRequestIds = [requestId].filter(Boolean);
              const settled = await settleMediaCredits({
                reservation,
                operationId: billingOperationId,
                userId: auth.userId,
                actual: calculateQwenImageCost({
                  resolution,
                  inputImageCount: referenceImages.length,
                }, reservation.settings),
                usage: { resolution, inputImageCount: referenceImages.length },
                upstreamRequestIds,
              });
              billingFinalized = true;
              sendEvent({ type: "credit_settled", billing: settled.billing });
            },
          };
          const saved = referenceImages.length > 0
            ? await editAndStoreImageFile({
                userId: auth.userId,
                prompt: effectivePrompt,
                images: referenceImages,
                size: mediaOptions.size,
                ownerType: "conversation",
                ownerId: currentConversationId,
                signal: req.signal,
                mediaWriteLease,
                ...billingCallbacks,
              })
            : await generateAndStoreImageFile({
                userId: auth.userId,
                prompt: effectivePrompt,
                size: mediaOptions.size,
                ownerType: "conversation",
                ownerId: currentConversationId,
                signal: req.signal,
                mediaWriteLease,
                ...billingCallbacks,
              });
          generatedFileIds.push(saved.fileId);
          const modelMessage = {
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
            type: "image_gen_complete",
            parts: modelMessage.parts,
            providerState: modelMessage.providerState,
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          if (reservation && !billingFinalized) {
            try {
              const result = !requestDispatched || isExplicitQwenImageRejection(error)
                ? await releaseMediaCredits({
                    reservation,
                    operationId: billingOperationId,
                    userId: auth.userId,
                    usage: { resolution, inputImageCount: referenceFileIds.length },
                    upstreamRequestIds: [error?.requestId].filter(Boolean),
                  })
                : await reviewMediaCredits({
                    reservation,
                    operationId: billingOperationId,
                    userId: auth.userId,
                    reason: upstreamComplete
                      ? "聊天图片上游已成功，但固定成本结算未完成"
                      : "聊天图片上游请求已发出，但未能确认完整结果",
                    usage: { resolution, inputImageCount: referenceFileIds.length },
                    upstreamRequestIds: upstreamRequestIds.length
                      ? upstreamRequestIds
                      : [error?.requestId].filter(Boolean),
                  });
              billingFinalized = true;
              sendEvent({
                type: result.billing?.status === "review_required"
                  ? "credit_review_required"
                  : "credit_settled",
                billing: result.billing,
              });
            } catch (billingError) {
              console.error("[Media Chat] finalize image billing:", billingError);
            }
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
    if (reservation && authenticatedUserId) {
      try {
        const released = await releaseMediaCredits({
          reservation,
          operationId: billingOperationId,
          userId: authenticatedUserId,
          usage: { failedBeforeUpstream: true },
        });
        preUpstreamBilling = released.billing;
      } catch (billingError) {
        console.error("[Media Chat] release pre-upstream image billing:", billingError);
      }
    }
    console.error("[Media Chat] request failed:", {
      name: error?.name || "Error",
      status: error?.status,
    });
    if (error instanceof CreditError) {
      return creditErrorResponse(error, "聊天图片积分预留失败");
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return Response.json(
      {
        error: error?.message || "媒体生成失败",
        ...(preUpstreamBilling ? { billing: preUpstreamBilling } : {}),
      },
      { status },
    );
  } finally {
    if (!mediaWriteLeaseTransferred) {
      await releaseMediaWriteLease();
    }
  }
}
