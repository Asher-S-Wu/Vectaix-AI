import { calculateAccumulatedCosts } from "@/lib/server/credits/chatCosts";
import crypto from "node:crypto";

import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import { getManagedModel } from "@/lib/server/models/service";
import {
  isNonEmptyString,
  sanitizeStoredMessagesStrict,
  generateMessageId,
} from "@/app/api/chat/utils";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
  loadConversationForRoute,
  nextConversationWriteTime,
  rollbackConversationTurn,
} from "@/app/api/chat/conversationState";
import {
  bindStoredFiles,
  collectStoredFileIds,
  deleteStoredFilesByIds,
  findOwnedStoredFile,
  getStoredFileAbsolutePath,
  serializeStoredFile,
} from "@/lib/server/storage/service";
import { IMAGE_MIME_TYPES } from "@/lib/shared/attachments";
import {
  buildDirectChatSystemPrompt,
} from "@/lib/server/chat/systemPromptBuilder";
import {
  parseSystemPrompt,
  parseWebSearchConfig,
  parseWebSearchEnabled,
} from "@/lib/server/chat/requestConfig";
import { normalizeProviderError, runDirectChat } from "@/lib/server/providers/directChat";
import {
  createWebBrowsingRuntime,
  executeWebBrowsingNativeToolCall,
  getWebToolDefinitions,
  WEB_BROWSING_MAX_ROUNDS,
} from "@/lib/server/webBrowsing/nativeTools";
import {
  createWebBrowsingRoundController,
} from "@/lib/server/webBrowsing/roundControl";
import {
  buildChatMessagesFromHistory,
  buildCurrentUserMessage,
  normalizeOpenAIMessageContentParts,
} from "@/app/api/chat/providerMessageHelpers";
import {
  CHAT_RATE_LIMIT,
  TEXT_CHAT_MAX_REQUEST_BYTES,
  SSE_PADDING,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/server/chat/routeConstants";
import { parseJsonRequest } from "@/lib/server/api/routeHelpers";
import {
  createPricingSnapshot,
} from "@/lib/server/credits/pricing";
import { getBillingSettings } from "@/lib/server/credits/settings";
import {
  getCreditOperation,
  markReviewRequired,
  releaseCredits,
  reserveCredits,
  settleCredits,
} from "@/lib/server/credits/service";
import { billingResult, creditErrorResponse } from "@/lib/server/credits/api";
import { CreditError } from "@/lib/server/credits/errors";
import { estimateChatInputTokens } from "@/lib/server/credits/chatEstimation";
import { probeVideoDuration } from "@/lib/media/server/videoMetadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CHAT_OUTPUT_TOKENS = 256;

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("请求包含无效数字");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  throw new Error("请求包含无法生成指纹的内容");
}

function createRequestFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}


function collectUpstreamRequestIds(usageRecords) {
  return Array.from(new Set(usageRecords.flatMap((record) => [record?.requestId, record?.responseId])
    .filter((value) => typeof value === "string" && value)));
}

function modelSupportsStoredFile(modelConfig, file) {
  const attachmentSupport = { supportsImages: modelConfig.nativeInputs.includes("image"), supportsAudio: modelConfig.nativeInputs.includes("audio"), supportsVideo: modelConfig.nativeInputs.includes("video") };
  if (file?.category === "image") {
    return attachmentSupport.supportsImages && IMAGE_MIME_TYPES.includes(file.mimeType);
  }
  if (file?.category === "audio") return attachmentSupport.supportsAudio;
  if (file?.category === "video") return attachmentSupport.supportsVideo;
  return false;
}

function collectStoredFileOccurrences(messages) {
  const fileIds = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (typeof part?.inlineData?.fileId === "string" && part.inlineData.fileId) {
        fileIds.push(part.inlineData.fileId);
      }
      if (typeof part?.fileData?.fileId === "string" && part.fileData.fileId) {
        fileIds.push(part.fileData.fileId);
      }
    }
  }
  return fileIds;
}

async function ensureChatMediaDurations(files, signal) {
  await Promise.all(files.map(async (file) => {
    if (!file || !["audio", "video"].includes(file.category)) return;
    const field = file.category === "audio" ? "audioDuration" : "videoDuration";
    if (Number.isFinite(file[field]) && file[field] > 0) return;
    let duration;
    try {
      duration = await probeVideoDuration(getStoredFileAbsolutePath(file), { signal });
    } catch {
      const error = new Error(`无法读取${file.category === "audio" ? "音频" : "视频"}附件时长`);
      error.status = 400;
      throw error;
    }
    file[field] = duration;
    await file.save();
  }));
}

function unsupportedAttachmentError() {
  const error = new Error("当前模型不支持这类文件");
  error.status = 400;
  return error;
}

function pushUniqueCitations(target, items) {
  if (!Array.isArray(target) || !Array.isArray(items)) return false;
  let changed = false;
  for (const item of items) {
    if (!item?.url) continue;
    if (!target.some((citation) => citation.url === item.url)) {
      target.push({
        url: item.url,
        title: item.title || item.url,
      });
      changed = true;
    }
  }
  return changed;
}

export async function POST(req) {
  let writePermitTime = null;

  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > TEXT_CHAT_MAX_REQUEST_BYTES) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }

    const parsed = await parseJsonRequest(
      req,
      "Invalid JSON in request body",
      TEXT_CHAT_MAX_REQUEST_BYTES
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const {
      prompt,
      model,
      config,
      history,
      conversationId,
      mode,
      messages,
      settings,
      userMessageId,
      modelMessageId,
      billingOperationId,
    } = body;

    if (!model || typeof model !== "string") {
      return Response.json({ error: "Model is required" }, { status: 400 });
    }
    if (typeof prompt !== "string") {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }
    if (
      typeof billingOperationId !== "string"
      || !/^[A-Za-z0-9_-]{8,100}$/.test(billingOperationId)
    ) {
      return Response.json({ error: "请求操作号无效，请刷新页面后重试" }, { status: 400 });
    }

    const auth = await getAuthPayload(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIP = getClientIP(req);
    const rateLimitKey = `chat:${auth.userId}:${clientIP}`;
    const { success, resetTime } = rateLimit(rateLimitKey, CHAT_RATE_LIMIT);
    if (!success) {
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      return Response.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(retryAfter), "X-RateLimit-Remaining": "0" } }
      );
    }

    let user = null;
    try {
      await dbConnect();
      const userDoc = await User.findById(auth.userId);
      if (!userDoc) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      user = auth;
    } catch (dbError) {
      console.error("[Chat] connect database:", dbError);
      return Response.json({ error: "Database connection failed" }, { status: 500 });
    }

    const modelConfig = await getManagedModel(model);
    let currentConversationId = conversationId;
    let currentConversation = await loadConversationForRoute({
      conversationId: currentConversationId,
      userId: user.userId,
      expectedMediaType: null,
    });
    let createdConversationForRequest = false;
    let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
    let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
    if (currentConversation?.updatedAt) writePermitTime = previousUpdatedAt.getTime();

    const currentAttachments = Array.isArray(config?.attachments)
      ? config.attachments.filter((item) => ["audio", "video"].includes(item?.category) && isNonEmptyString(item?.fileId))
      : [];

    const isRegenerateMode = mode === "regenerate" && user && currentConversationId && Array.isArray(messages);
    const resolvedUserMessageId = (typeof userMessageId === "string" && userMessageId.trim()) ? userMessageId.trim() : generateMessageId();
    const resolvedModelMessageId = (typeof modelMessageId === "string" && modelMessageId.trim()) ? modelMessageId.trim() : generateMessageId();

    const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
    const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
    let webSearchConfig;
    let enableWebSearch;
    try {
      webSearchConfig = parseWebSearchConfig(config?.webSearch);
      enableWebSearch = parseWebSearchEnabled(config?.webSearch);
    } catch (error) {
      return Response.json({ error: error?.message || "webSearch invalid" }, { status: 400 });
    }
    const requestedImages = Array.isArray(config?.images)
      ? config.images.filter((item) => isNonEmptyString(item?.fileId))
      : [];
    if (!isRegenerateMode && !isNonEmptyString(prompt) && requestedImages.length === 0 && currentAttachments.length === 0) {
      return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
    }
    let sanitizedRegenerateMessages = null;
    if (isRegenerateMode) {
      try {
        sanitizedRegenerateMessages = sanitizeStoredMessagesStrict(messages);
      } catch (error) {
        return Response.json({ error: error?.message || "messages invalid" }, { status: 400 });
      }
    }

    const attachStoredProviderState = (msgs) => {
      const storedById = new Map(
        previousMessages
          .filter((message) => typeof message?.id === "string" && message.id && message?.providerState)
          .map((message) => [message.id, message.providerState])
      );
      return msgs.map((message) => {
        const state = typeof message?.id === "string" ? storedById.get(message.id) : null;
        return state ? { ...message, providerState: state } : message;
      });
    };
    const effectiveHistory = isRegenerateMode
      ? sanitizedRegenerateMessages
      : attachStoredProviderState(history);
    const referencedFileIds = Array.from(new Set([
      ...collectStoredFileIds(effectiveHistory),
      ...requestedImages.map((item) => item.fileId),
      ...currentAttachments.map((item) => item.fileId),
    ]));
    const validatedFiles = await Promise.all(referencedFileIds.map((fileId) => (
      findOwnedStoredFile({ userId: user.userId, fileId })
    )));
    if (validatedFiles.some((file) => !file || file.kind === "audio-source")) {
      return Response.json({ error: "附件不存在或无权访问" }, { status: 400 });
    }
    const allowedOwnerId = currentConversationId ? String(currentConversationId) : null;
    if (validatedFiles.some((file) => (
      file.ownerType !== "temporary"
      && !(file.ownerType === "conversation" && allowedOwnerId && String(file.ownerId) === allowedOwnerId)
    ))) {
      return Response.json({ error: "附件已被其他内容占用" }, { status: 400 });
    }
    if (validatedFiles.some((file) => !modelSupportsStoredFile(modelConfig, file))) {
      return Response.json({ error: "当前模型不支持这类文件" }, { status: 400 });
    }
    await ensureChatMediaDurations(validatedFiles, req.signal);
    const validatedFileDocumentMap = new Map(validatedFiles.map((file) => [file.fileId, file]));
    const validatedFileMap = new Map(validatedFiles.map((file) => [file.fileId, serializeStoredFile(file)]));
    const estimatedInputFiles = [
      ...collectStoredFileOccurrences(effectiveHistory),
      ...(!isRegenerateMode ? requestedImages.map((item) => item.fileId) : []),
      ...(!isRegenerateMode ? currentAttachments.map((item) => item.fileId) : []),
    ].map((fileId) => validatedFileDocumentMap.get(fileId)).filter(Boolean);
    const prebuiltHistoryMessages = await buildChatMessagesFromHistory(effectiveHistory, { userId: user.userId });
    const prebuiltDbImageEntries = requestedImages
      .map((item) => validatedFileMap.get(item.fileId))
      .filter((file) => file?.category === "image");
    const prebuiltAttachmentEntries = currentAttachments
      .map((item) => validatedFileMap.get(item.fileId))
      .filter((file) => file && ["audio", "video"].includes(file.category));
    const prebuiltCurrentContent = isRegenerateMode
      ? null
      : await buildCurrentUserMessage({
        prompt,
        images: prebuiltDbImageEntries,
        attachments: prebuiltAttachmentEntries,
        userId: user.userId,
      });
    if (!isRegenerateMode && prebuiltCurrentContent.length === 0) {
      return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
    }

    const operationId = `chat:${user.userId}:${billingOperationId}`;
    const provider = modelConfig.provider || "";
    const requestFingerprint = createRequestFingerprint({ userId: user.userId, body });
    const claimId = crypto.randomUUID();
    let billingSettings;
    let pricingSnapshot;
    let reservationTransaction;
    let operationClaimed = false;
    let systemPrompt;
    try {
      const existingOperation = await getCreditOperation({
        operationId,
        userId: user.userId,
        requestFingerprint,
      });
      if (existingOperation) {
        const operationFinished = ["settled", "released", "rejected"].includes(existingOperation.status);
        throw new CreditError(
          operationFinished
            ? "本次请求已经处理完成，请勿重复提交"
            : "本次请求已在处理中，请勿重复提交",
          {
            code: operationFinished
              ? "CREDIT_OPERATION_ALREADY_PROCESSED"
              : "CREDIT_OPERATION_ALREADY_CLAIMED",
            statusCode: 409,
            details: {
              status: existingOperation.status,
              pricingVersion: existingOperation.pricingSnapshot?.version ?? null,
            },
          },
        );
      }
      systemPrompt = await buildDirectChatSystemPrompt({
        userSystemPrompt, systemPromptSuffix, enableWebSearch, searchContextSection: "",
      });
      billingSettings = await getBillingSettings();
      pricingSnapshot = createPricingSnapshot(billingSettings);
      reservationTransaction = await reserveCredits({
        operationId,
        userId: user.userId,
        type: "model_usage",
        feature: enableWebSearch ? "chat_web_search" : "chat",
        provider,
        model,
        usage: { requestFingerprint },
        pricingSnapshot,
        executionClaimId: claimId,
      });
      if (
        reservationTransaction?.status !== "reserved"
        || reservationTransaction?.executionClaimId !== claimId
      ) {
        throw new CreditError("聊天费用记录状态异常", {
          code: "CREDIT_RESERVATION_STATE_CONFLICT",
          statusCode: 409,
          details: { status: reservationTransaction?.status },
        });
      }
      operationClaimed = true;
    } catch (billingError) {
      return creditErrorResponse(billingError, "聊天费用记录失败");
    }

    let chatMessages = [];
    let newlyBoundFileIds = [];
    let removedFileIdsAfterRegenerate = [];
    const rollbackPreparedTurn = async () => {
      await rollbackConversationTurn({
        conversationId: currentConversationId,
        userId: user.userId,
        createdConversationForRequest,
        isRegenerateMode,
        previousMessages,
        previousUpdatedAt,
        userMessageId: resolvedUserMessageId,
        modelMessageId: resolvedModelMessageId,
        writePermitTime,
        newlyBoundFileIds,
      });
    };
    try {
      if (user && !currentConversationId) {
        const titleSource = isNonEmptyString(prompt) ? prompt : (currentAttachments[0]?.name || (config?.images?.length ? "图片对话" : "New Chat"));
        const title = titleSource.length > 30 ? `${titleSource.substring(0, 30)}…` : titleSource;
        const newConv = await Conversation.create({
          userId: user.userId,
          title,
          model,
          settings: {
            ...(settings && typeof settings === "object" ? settings : {}),
            webSearch: webSearchConfig,
          },
          messages: [],
        });
        currentConversationId = newConv._id.toString();
        currentConversation = newConv.toObject();
        createdConversationForRequest = true;
        previousMessages = [];
        previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
        writePermitTime = previousUpdatedAt.getTime();
      }

      if (isRegenerateMode) {
        const reboundFiles = await bindStoredFiles({
          userId: user.userId,
          fileIds: collectStoredFileIds(sanitizedRegenerateMessages),
          ownerType: "conversation",
          ownerId: currentConversationId,
        });
        newlyBoundFileIds = reboundFiles
          .filter((file) => file.ownerType === "temporary")
          .map((file) => file.fileId);
        if (reboundFiles.some((file) => !modelSupportsStoredFile(modelConfig, file))) {
          throw unsupportedAttachmentError();
        }
        const nextFileIds = new Set(collectStoredFileIds(sanitizedRegenerateMessages));
        removedFileIdsAfterRegenerate = collectStoredFileIds(previousMessages)
          .filter((fileId) => !nextFileIds.has(fileId));
        const regenerateTime = nextConversationWriteTime(writePermitTime);
        const conv = await Conversation.findOneAndUpdate(
          buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
          { $set: { messages: sanitizedRegenerateMessages, updatedAt: regenerateTime } },
          { new: true }
        ).select("messages updatedAt");
        if (!conv) {
          const error = new Error("Not found");
          error.status = 404;
          throw error;
        }
        writePermitTime = conv.updatedAt?.getTime?.();
        chatMessages = prebuiltHistoryMessages.slice();
      } else {
        chatMessages = prebuiltHistoryMessages.slice();
        const requestedIds = [
          ...requestedImages.map((item) => item.fileId),
          ...currentAttachments.map((item) => item.fileId),
        ];
        const boundFiles = await bindStoredFiles({
          userId: user.userId,
          fileIds: requestedIds,
          ownerType: "conversation",
          ownerId: currentConversationId,
        });
        newlyBoundFileIds = boundFiles
          .filter((file) => file.ownerType === "temporary")
          .map((file) => file.fileId);
        if (boundFiles.some((file) => !modelSupportsStoredFile(modelConfig, file))) {
          throw unsupportedAttachmentError();
        }
        chatMessages.push({ role: "user", content: normalizeOpenAIMessageContentParts(prebuiltCurrentContent) });

        const storedUserParts = [];
        if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });
        for (const entry of prebuiltDbImageEntries) {
          storedUserParts.push({ inlineData: { fileId: entry.fileId, mimeType: entry.mimeType, url: entry.url } });
        }
        for (const attachment of prebuiltAttachmentEntries) {
          storedUserParts.push({
            fileData: {
              fileId: attachment.fileId, url: attachment.url, name: attachment.name, mimeType: attachment.mimeType,
              size: attachment.size, extension: attachment.extension, category: attachment.category,
            },
          });
        }
        const userMsgTime = nextConversationWriteTime(writePermitTime);
        const updatedConv = await Conversation.findOneAndUpdate(
          buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
          {
            $push: { messages: { id: resolvedUserMessageId, role: "user", content: prompt, type: "parts", parts: storedUserParts } },
            $set: { updatedAt: userMsgTime },
          },
          { new: true }
        ).select("updatedAt");
        if (!updatedConv) {
          const error = new Error("Not found");
          error.status = 404;
          throw error;
        }
        writePermitTime = updatedConv.updatedAt?.getTime?.() ?? userMsgTime.getTime();
      }
    } catch (preparationError) {
      let billingCleanupError = null;
      if (operationClaimed) {
        try {
          await releaseCredits(operationId, {
            usage: { requestFingerprint, preparationFailed: true },
            pricingSnapshot,
          });
        } catch (releaseError) {
          billingCleanupError = releaseError;
          try {
            await markReviewRequired(operationId, {
              reason: releaseError?.message || "本地准备失败后无法结束费用记录",
              usage: { requestFingerprint, preparationFailed: true },
            });
          } catch { /* preserve the release error */ }
        }
      }
      try { await rollbackPreparedTurn(); } catch { /* ignore */ }
      throw billingCleanupError || preparationError;
    }

    const encoder = new TextEncoder();
    let clientAborted = req.signal.aborted;
    const onAbort = () => { clientAborted = true; };
    try { req?.signal?.addEventListener?.("abort", onAbort, { once: true }); } catch { /* ignore */ }

    let paddingSent = false;
    let heartbeatTimer = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        let fullText = "";
        let fullThought = "";
        let finalUsage = null;
        const usageRecords = [];
        let upstreamRequestCount = 0;
        let finalProviderState = null;
        let finalMessagePersisted = false;
        let billingFinalized = false;
        const citations = [];
        const toolRecords = [];
        const observedUpstreamIds = new Set();
        let sendEvent;
        let sendBillingEvent;
        let billingUsage;
        let finalizeBilling;

        const rollbackCurrentTurn = async ({ includePersisted = false, preserveCreatedConversation = false } = {}) => {
          if (finalMessagePersisted && !includePersisted) return false;
          await rollbackConversationTurn({
            conversationId: currentConversationId,
            userId: user.userId,
            createdConversationForRequest: createdConversationForRequest && !preserveCreatedConversation,
            isRegenerateMode,
            previousMessages,
            previousUpdatedAt,
            userMessageId: resolvedUserMessageId,
            modelMessageId: resolvedModelMessageId,
            writePermitTime,
            newlyBoundFileIds,
          });
        };

        try {
          sendEvent = (payload) => {
            if (clientAborted) return;
            const padding = !paddingSent ? SSE_PADDING : "";
            paddingSent = true;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
          };

          sendBillingEvent = (type, transaction) => {
            if (!clientAborted) {
              sendEvent({
                type,
                billing: billingResult(transaction),
                messagePersisted: finalMessagePersisted,
              });
            }
          };

          billingUsage = () => ({
            model,
            requestFingerprint,
            usageRecords,
            upstreamRequestCount,
            upstreamRequestIds: Array.from(observedUpstreamIds),
          });

          finalizeBilling = async ({ reason = "" } = {}) => {
            if (billingFinalized) return null;
            const upstreamRequestIds = Array.from(observedUpstreamIds);
            const hasUnmeteredUpstream = upstreamRequestCount > usageRecords.length;
            let transaction;
            if (hasUnmeteredUpstream) {
              transaction = await markReviewRequired(operationId, {
                reason: reason || "上游模型请求已发出，但没有取得完整用量",
                usage: billingUsage(),
              });
              billingFinalized = true;
              sendBillingEvent("credit_review_required", transaction);
              return { transaction, reviewRequired: true };
            }

            if (usageRecords.length > 0) {
              let costs;
              try {
                costs = calculateAccumulatedCosts({
                  model,
                  provider,
                  usageRecords,
                  settings: billingSettings,
                  requestFingerprint,
                });
              } catch (costError) {
                transaction = await markReviewRequired(operationId, {
                  reason: costError?.message || reason || "无法计算完整用量",
                  usage: billingUsage(),
                });
                billingFinalized = true;
                sendBillingEvent("credit_review_required", transaction);
                return { transaction, reviewRequired: true };
              }
              transaction = await settleCredits({
                operationId,
                ...costs,
                pricingSnapshot,
                upstreamRequestIds,
              });
            } else {
              transaction = await releaseCredits(operationId, {
                usage: billingUsage(),
                pricingSnapshot,
                upstreamRequestIds,
              });
            }
            billingFinalized = true;
            sendBillingEvent("credit_settled", transaction);
            return { transaction, reviewRequired: false };
          };

          const resolvePassMaxOutputTokens = ({ inputPayload }) => {
            const estimatedInputTokens = estimateChatInputTokens({
              inputPayload,
              provider,
              files: estimatedInputFiles,
            });
            const outputBudget = Math.min(modelConfig.maxOutputTokens, modelConfig.contextWindow - estimatedInputTokens);
            if (outputBudget < MIN_CHAT_OUTPUT_TOKENS) throw new Error("对话内容超过该模型的上下文长度，请减少附件或开始新对话");
            return outputBudget;
          };

          sendEvent({
            type: "credit_reserved",
            billing: billingResult(reservationTransaction),
          });
          const sendHeartbeat = () => {
            try { if (!clientAborted) controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`)); } catch { /* ignore */ }
          };
          heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
          sendHeartbeat();

          const pushCitations = (items) => {
            if (pushUniqueCitations(citations, items)) {
              sendEvent({ type: "citations", citations });
            }
          };

          const runtime = enableWebSearch
            ? createWebBrowsingRuntime({ webSearchOptions: webSearchConfig })
            : null;
          const roundController = enableWebSearch
            ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
            : null;
          const tools = enableWebSearch
            ? getWebToolDefinitions()
            : undefined;
          const result = await runDirectChat({
            model,
            messages: chatMessages,
            system: systemPrompt,
            cacheKey: `vectaix-${currentConversationId}`,
            tools,
            getTools: () => getWebToolDefinitions(roundController?.getAvailableToolApiNames() || []),
            signal: req?.signal,
            resolveMaxOutputTokens: resolvePassMaxOutputTokens,
            onUpstreamRequest() {
              upstreamRequestCount += 1;
            },
            onUpstreamId(id) {
              if (typeof id === "string" && id) observedUpstreamIds.add(id);
            },
            onUsageRecord(record) {
              usageRecords.push(record);
              for (const id of collectUpstreamRequestIds([record])) observedUpstreamIds.add(id);
            },
            onText(delta) {
              if (!delta || clientAborted) return;
              fullText += delta;
              sendEvent({ type: "text", content: delta });
            },
            onThought(delta) {
              if (!delta || clientAborted) return;
              fullThought += delta;
              sendEvent({ type: "thought", content: delta });
            },
            async executeTool(call) {
              const reservation = roundController.reserve(call?.name);
              if (!reservation.allowed) {
                throw new Error(`联网工具调用超出限制：${call?.name || "unknown"}`);
              }
              const toolExecution = await executeWebBrowsingNativeToolCall({
                apiName: call.name,
                argumentsInput: call.arguments,
                runtime,
                sendEvent,
                pushCitations,
                round: reservation.round,
                signal: req?.signal,
              });
              toolRecords.push(toolExecution.toolRecord);
              if (toolExecution.result?.success === false) {
                throw new Error(toolExecution.outputText || "联网搜索失败");
              }
              return toolExecution.outputText;
            },
          });
          finalUsage = result.usage || null;
          finalProviderState = result.providerState || null;

          if (clientAborted) {
            await finalizeBilling({ reason: "用户中断了聊天请求" });
            await rollbackCurrentTurn();
            try { controller.close(); } catch { /* ignore */ }
            return;
          }

          fullText = fullText.trim();
          fullThought = fullThought.trim();

          const isGoogleBlankRefusal = (
            provider === "google"
            && fullText === ""
            && fullThought === ""
            && citations.length === 0
          );
          if (isGoogleBlankRefusal) {
            await finalizeBilling();
            await rollbackCurrentTurn({ preserveCreatedConversation: true });
            if (!clientAborted) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          if (user && currentConversationId) {
            if (clientAborted) {
              await finalizeBilling({ reason: "用户中断了聊天请求" });
              await rollbackCurrentTurn();
              try { controller.close(); } catch { /* ignore */ }
              return;
            }
            const providerState = finalProviderState
              ? { ...finalProviderState, usage: finalUsage }
              : (finalUsage ? { usage: finalUsage } : undefined);
            const modelMessage = {
              id: resolvedModelMessageId,
              role: "model",
              model,
              content: fullText,
              thought: fullThought,
              type: "text",
              parts: [{ text: fullText }],
              ...(toolRecords.length > 0 ? { tools: toolRecords } : {}),
              ...(citations.length > 0 ? { citations } : {}),
              ...(providerState ? { providerState } : {}),
            };
            const persistedConversation = await Conversation.findOneAndUpdate(
              buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
              {
                $push: { messages: modelMessage },
                $set: { updatedAt: nextConversationWriteTime(writePermitTime) },
              },
              { new: true }
            ).select("updatedAt");
            if (!persistedConversation) {
              const conflictError = new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
              conflictError.status = 409;
              throw conflictError;
            }
            finalMessagePersisted = true;
            writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();
            if (clientAborted) {
              await finalizeBilling({ reason: "用户中断了聊天请求" });
              await rollbackCurrentTurn({ includePersisted: true });
              try { controller.close(); } catch { /* ignore */ }
              return;
            }
          }
          await finalizeBilling();
          if (clientAborted) {
            await rollbackCurrentTurn({ includePersisted: true });
            try { controller.close(); } catch { /* ignore */ }
            return;
          }
          if (removedFileIdsAfterRegenerate.length > 0) {
            await deleteStoredFilesByIds({
              userId: user.userId,
              fileIds: removedFileIdsAfterRegenerate,
              ownerType: "conversation",
              ownerId: currentConversationId,
            });
          }
          if (!clientAborted) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
        } catch (err) {
          const error = normalizeProviderError(err);
          let billingError = null;
          if (!billingFinalized) {
            try {
              const settlement = await finalizeBilling({ reason: error?.message || "聊天执行失败" });
              if (settlement?.reviewRequired) {
                billingError = new Error("本次模型用量无法自动核对，费用已标记待核对");
              }
            } catch (settlementError) {
              billingError = settlementError;
              try {
                const reviewTransaction = await markReviewRequired(operationId, {
                  reason: settlementError?.message || "费用记录失败",
                  usage: billingUsage(),
                });
                billingFinalized = true;
                sendBillingEvent("credit_review_required", reviewTransaction);
              } catch { /* retain the settlement error */ }
            }
          }
          if (clientAborted) {
            try { await rollbackCurrentTurn({ includePersisted: true }); } catch { /* ignore */ }
            try { controller.close(); } catch { /* ignore */ }
            return;
          }
          try { await rollbackCurrentTurn(); } catch { /* ignore */ }
          try {
            const errorPayload = JSON.stringify({
              type: "stream_error",
              message: billingError?.message || error?.message || "Unknown error",
              messagePersisted: finalMessagePersisted,
            });
            const padding = !paddingSent ? SSE_PADDING : "";
            paddingSent = true;
            controller.enqueue(encoder.encode(`data: ${errorPayload}${padding}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            controller.error(error);
          }
        } finally {
          if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          try { req?.signal?.removeEventListener?.("abort", onAbort); } catch { /* ignore */ }
        }
      },
    });

    const headers = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
    if (currentConversationId) {
      headers["X-Conversation-Id"] = currentConversationId;
    }
    return new Response(responseStream, { headers });
  } catch (error) {
    console.error("[Chat] handle chat request:", error);
    const rawStatus = typeof error?.status === "number" ? error.status : 500;
    const isUpstreamAuthError = rawStatus === 401;
    const status = isUpstreamAuthError ? 500 : rawStatus;
    let errorMessage = error?.message;
    if (isUpstreamAuthError) {
      errorMessage = "模型服务认证失败，请检查接口配置";
    } else if (error?.message?.includes("API_KEY")) {
      errorMessage = error.message;
    }
    return Response.json({ error: errorMessage }, { status });
  }
}
