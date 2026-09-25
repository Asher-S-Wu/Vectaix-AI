import dbConnect from "@/lib/db";
import { billingResult, creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import {
  releaseMediaCredits,
  reserveMediaCredits,
  reviewMediaCredits,
} from "@/lib/media/server/billing";
import { assertMediaCreditOperationUnused, requireMediaCreditOperation } from "@/lib/media/server/creditOperation";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  getModelConfig,
  isImageGenerationModel,
} from "@/lib/shared/models";
import {
  getImageModelConfig,
  validateImageOptions,
  validateImageReferences,
} from "@/lib/media/shared/models";
import {
  createAndStoreImageFiles,
  finalizeImageBilling,
  getImageFeature,
  imageBillingUsage,
  resolveImageServiceConfig,
  validateImagePrompt,
} from "@/lib/media/server/imageService";
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

function createHttpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicImageErrorMessage(error) {
  const status = error?.status;
  if (Number.isInteger(status) && status >= 400 && status < 500) return error.message;
  if (error?.code === "SERVICE_NOT_CONFIGURED") return error.message;
  return "媒体生成失败";
}

function normalizeImageOptions(model, value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return validateImageOptions({ model, size: input.size, quality: input.quality, count: input.count });
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

async function loadReferenceImages({ userId, fileIds, model }) {
  const config = getImageModelConfig(model);
  if (fileIds.length > config.maxReferenceImages) throw createHttpError(`最多支持 ${config.maxReferenceImages} 张参考图片`);
  const files = [];
  for (const fileId of fileIds) {
    const stored = await findOwnedStoredFile({ userId, fileId });
    if (!stored) throw createHttpError("参考图片不存在或无权访问", 404);
    if (stored.category !== "image") throw createHttpError("参考图片格式不受支持");
    files.push(stored);
  }
  validateImageReferences(model, files.map(file => ({ name: file.originalName, type: file.mimeType, size: file.size })));
  const images = [];
  for (const file of files) {
    images.push(new File([await readStoredFileBuffer(file)], file.originalName, { type: file.mimeType }));
  }
  return images;
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
        { error: "此接口仅支持图片生成" },
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
      expectedMediaType: getModelConfig(model)?.mediaType,
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
    let referenceImages = [];
    const reserveImageCredits = async (inputImageCount, fingerprintInput) => {
      resolveImageServiceConfig(model);
      const feature = getImageFeature(model, inputImageCount > 0);
      const creditOperation = requireMediaCreditOperation(req, {
        userId: auth.userId,
        feature,
        fingerprintInput,
      });
      billingOperationId = creditOperation.operationId;
      await assertMediaCreditOperationUnused({ ...creditOperation, userId: auth.userId });
      const billingSettings = await (await import("@/lib/server/credits/settings")).getBillingSettings();
      reservation = await reserveMediaCredits({
        operationId: billingOperationId,
        userId: auth.userId,
        feature,
        provider: getImageModelConfig(model).service,
        model,

        settings: billingSettings,
        usage: imageBillingUsage(mediaOptions, inputImageCount),
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
      validateImagePrompt(model, regeneratedPrompt);
      mediaOptions = normalizeImageOptions(model, currentUserMessage?.providerState?.media);
      referenceImages = await loadReferenceImages({ userId: auth.userId, fileIds: regeneratedImageIds, model });
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
      mediaOptions = normalizeImageOptions(model, config?.media);
      const requestedImages = Array.isArray(config?.images)
        ? config.images.filter((item) => isNonEmptyString(item?.fileId))
        : [];
      const requestedImageIds = Array.from(new Set(
        requestedImages.map((item) => item.fileId.trim())
      ));
      const promptText = prompt.trim();
      validateImagePrompt(model, promptText);
      referenceImages = await loadReferenceImages({ userId: auth.userId, fileIds: requestedImageIds, model });
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
            name: storedReference.name,
            size: storedReference.size,
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
    validateImagePrompt(model, effectivePrompt);

    const encoder = new TextEncoder();
    let clientAborted = req.signal.aborted;
    const onAbort = () => { clientAborted = true; };
    req.signal.addEventListener("abort", onAbort, { once: true });

    let paddingSent = false;
    let heartbeatTimer = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        let finalMessagePersisted = false;
        let billingFinalized = false;
        let requestDispatched = false;
        let batch = null;
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
            billing: billingResult(reservation.transaction),
          });
          await assertMediaWriteLeaseActive(mediaWriteLease);
          batch = await createAndStoreImageFiles({
            ...mediaOptions, userId: auth.userId, prompt: effectivePrompt,
            images: referenceImages, ownerType: "conversation", ownerId: currentConversationId,
            signal: req.signal, mediaWriteLease,
            onRequestDispatched: () => { requestDispatched = true; },
            onFileSaved: saved => { generatedFileIds.push(saved.fileId); },
          });
          upstreamRequestIds = batch.outcomes.flatMap(item => item.attempts.map(attempt => attempt.requestId)).filter(Boolean);
          const settled = await finalizeImageBilling({ reservation, options: mediaOptions, inputImageCount: referenceImages.length, outcomes: batch.outcomes });
          billingFinalized = true;
          sendEvent({ type: settled.billing.status === "review_required" ? "credit_review_required" : "credit_settled", billing: settled.billing });
          if (!batch.results.some(item => item.success)) throw createHttpError(batch.results.map((item, index) => `第 ${index + 1} 张：${item.message}`).join("；"), batch.results[0].status);

          const modelMessage = {
            id: resolvedModelMessageId,
            role: "model",
            model,
            content: "",
            type: "parts",
            parts: batch.results.map((item, index) => item.success ? {
              inlineData: { fileId: item.fileId, url: item.url, mimeType: item.mimeType, name: item.name, size: item.size },
            } : { text: `第 ${index + 1} 张生成失败：${item.message}` }),
            providerState: { media: { type: "image", model, options: mediaOptions } },
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
              const result = !requestDispatched || error?.upstreamRejected === true
                ? await releaseMediaCredits({
                    reservation,
                    operationId: billingOperationId,
                    userId: auth.userId,
                    usage: { ...reservation.transaction.usage, ...(batch ? { imageOutcomes: batch.outcomes } : {}) },
                    upstreamRequestIds: [error?.requestId].filter(Boolean),
                  })
                : await reviewMediaCredits({
                    reservation,
                    operationId: billingOperationId,
                    userId: auth.userId,
                    reason: "聊天图片费用记录未完成",
                    usage: { ...reservation.transaction.usage, ...(batch ? { imageOutcomes: batch.outcomes } : {}) },
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
            sendEvent({ type: "stream_error", message: publicImageErrorMessage(error) });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            controller.error(error);
          }
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          req.signal.removeEventListener("abort", onAbort);
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
          usage: { ...reservation.transaction.usage, failedBeforeUpstream: true },
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
      return creditErrorResponse(error, "聊天图片费用记录失败");
    }
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    return Response.json(
      {
        error: publicImageErrorMessage(error),
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
