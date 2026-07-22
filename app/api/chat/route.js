import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import {
  getModelConfig,
  getModelAttachmentSupport,
  isDirectChatModel,
} from "@/lib/shared/models";
import {
  isNonEmptyString,
  sanitizeStoredMessagesStrict,
  generateMessageId,
  estimateTokens,
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
  serializeStoredFile,
} from "@/lib/server/storage/service";
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
  MAX_REQUEST_BYTES,
  SSE_PADDING,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/server/chat/routeConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

    if (!model || typeof model !== "string") {
      return Response.json({ error: "Model is required" }, { status: 400 });
    }
    if (typeof prompt !== "string") {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return Response.json({ error: "history must be an array" }, { status: 400 });
    }
    if (!isDirectChatModel(model)) {
      return Response.json({ error: "unsupported model" }, { status: 400 });
    }

    const auth = await getAuthPayload();
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

    let currentConversationId = conversationId;
    let currentConversation = await loadConversationForRoute({
      conversationId: currentConversationId,
      userId: user.userId,
      expectedProvider: getModelConfig(model)?.provider,
    });
    let createdConversationForRequest = false;
    let previousMessages = Array.isArray(currentConversation?.messages) ? currentConversation.messages : [];
    let previousUpdatedAt = currentConversation?.updatedAt ? new Date(currentConversation.updatedAt) : new Date();

    const currentAttachments = Array.isArray(config?.attachments)
      ? config.attachments.filter((item) => ["audio", "video"].includes(item?.category) && isNonEmptyString(item?.fileId))
      : [];

    const limit = Number.parseInt(historyLimit, 10);
    if (!Number.isFinite(limit) || limit < 0) {
      return Response.json({ error: "historyLimit invalid" }, { status: 400 });
    }

    const isRegenerateMode = mode === "regenerate" && user && currentConversationId && Array.isArray(messages);
    const resolvedUserMessageId = (typeof userMessageId === "string" && userMessageId.trim()) ? userMessageId.trim() : generateMessageId();
    const resolvedModelMessageId = (typeof modelMessageId === "string" && modelMessageId.trim()) ? modelMessageId.trim() : generateMessageId();

    let chatMessages = [];
    let storedMessagesForRegenerate = null;
    let newlyBoundFileIds = [];
    let removedFileIdsAfterRegenerate = [];

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

    if (isRegenerateMode) {
      let sanitized;
      try {
        sanitized = sanitizeStoredMessagesStrict(messages);
      } catch (e) {
        return Response.json({ error: e?.message || "messages invalid" }, { status: 400 });
      }
      const reboundFiles = await bindStoredFiles({
        userId: user.userId,
        fileIds: collectStoredFileIds(sanitized),
        ownerType: "conversation",
        ownerId: currentConversationId,
      });
      newlyBoundFileIds = reboundFiles
        .filter((file) => file.ownerType === "temporary")
        .map((file) => file.fileId);
      const regenerateTime = new Date();
      const nextFileIds = new Set(collectStoredFileIds(sanitized));
      removedFileIdsAfterRegenerate = collectStoredFileIds(previousMessages)
        .filter((fileId) => !nextFileIds.has(fileId));
      const conv = await Conversation.findOneAndUpdate(
        { _id: currentConversationId, userId: user.userId },
        { $set: { messages: sanitized, updatedAt: regenerateTime } },
        { new: true }
      ).select("messages updatedAt");
      if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
      storedMessagesForRegenerate = sanitized;
      writePermitTime = conv.updatedAt?.getTime?.();

      const msgs = storedMessagesForRegenerate;
      const historyBeforeCurrentPrompt = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === "user" ? msgs.slice(0, -1) : msgs;
      const currentTurn = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === "user" ? [msgs[msgs.length - 1]] : [];
      const effectiveHistory = (limit > 0) ? historyBeforeCurrentPrompt.slice(-limit) : historyBeforeCurrentPrompt;
      const inputMessages = [...effectiveHistory, ...currentTurn];
      chatMessages = await buildChatMessagesFromHistory(inputMessages, { userId: user.userId });
    } else {
      const effectiveHistory = attachStoredProviderState((limit > 0) ? history.slice(-limit) : history);
      chatMessages = await buildChatMessagesFromHistory(effectiveHistory, { userId: user.userId });
    }

    const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
    const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
    let webSearchConfig;
    let enableWebSearch;
    try {
      webSearchConfig = parseWebSearchConfig(config?.webSearch);
      enableWebSearch = parseWebSearchEnabled(config?.webSearch) && getModelConfig(model)?.supportsWebSearch === true;
    } catch (error) {
      return Response.json({ error: error?.message || "webSearch invalid" }, { status: 400 });
    }

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
    }

    let dbImageEntries = [];
    let attachmentEntries = [];
    if (!isRegenerateMode) {
      const requestedImages = Array.isArray(config?.images)
        ? config.images.filter((item) => isNonEmptyString(item?.fileId))
        : [];
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
      const attachmentSupport = getModelAttachmentSupport(model);
      for (const file of boundFiles) {
        const supported = (
          (file.category === "image" && attachmentSupport.supportsImages)
          || (file.category === "audio" && attachmentSupport.supportsAudio)
          || (file.category === "video" && attachmentSupport.supportsVideo)
        );
        if (!supported) {
          await deleteStoredFilesByIds({
            userId: user.userId,
            fileIds: newlyBoundFileIds,
            ownerType: "conversation",
            ownerId: currentConversationId,
          });
          const unsupportedError = new Error("当前模型不支持这类文件");
          unsupportedError.status = 400;
          throw unsupportedError;
        }
      }
      const fileMap = new Map(boundFiles.map((file) => [file.fileId, serializeStoredFile(file)]));
      dbImageEntries = requestedImages
        .map((item) => fileMap.get(item.fileId))
        .filter((file) => file?.category === "image");
      attachmentEntries = currentAttachments
        .map((item) => fileMap.get(item.fileId))
        .filter((file) => file && ["audio", "video"].includes(file.category));

      const currentContent = await buildCurrentUserMessage({
        prompt,
        images: dbImageEntries,
        attachments: attachmentEntries,
        userId: user.userId,
      });
      if (currentContent.length === 0) {
        return Response.json({ error: "请至少输入内容或上传附件" }, { status: 400 });
      }
      chatMessages.push({
        role: "user",
        content: normalizeOpenAIMessageContentParts(currentContent),
      });

      if (user) {
        const storedUserParts = [];
        if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });
        for (const entry of dbImageEntries) {
          storedUserParts.push({ inlineData: { fileId: entry.fileId, mimeType: entry.mimeType, url: entry.url } });
        }
        for (const attachment of attachmentEntries) {
          storedUserParts.push({
            fileData: {
              fileId: attachment.fileId, url: attachment.url, name: attachment.name, mimeType: attachment.mimeType,
              size: attachment.size, extension: attachment.extension, category: attachment.category,
            },
          });
        }
        const userMsgTime = new Date();
        const userMessage = {
          id: resolvedUserMessageId, role: "user", content: prompt, type: "parts", parts: storedUserParts,
        };
        const updatedConv = await Conversation.findOneAndUpdate(
          { _id: currentConversationId, userId: user.userId },
          { $push: { messages: userMessage }, updatedAt: userMsgTime },
          { new: true }
        ).select("updatedAt");
        if (!updatedConv) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        writePermitTime = updatedConv.updatedAt?.getTime?.() ?? userMsgTime.getTime();
      }
    }

    const encoder = new TextEncoder();
    let clientAborted = false;
    const onAbort = () => { clientAborted = true; };
    try { req?.signal?.addEventListener?.("abort", onAbort, { once: true }); } catch { /* ignore */ }

    let paddingSent = false;
    let heartbeatTimer = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        let fullText = "";
        let fullThought = "";
        let finalUsage = null;
        let finalProviderState = null;
        let finalMessagePersisted = false;
        const citations = [];
        const toolRecords = [];
        let searchContextTokens = 0;

        const rollbackCurrentTurn = async () => {
          if (finalMessagePersisted) return;
          await rollbackConversationTurn({
            conversationId: currentConversationId,
            userId: user.userId,
            createdConversationForRequest,
            isRegenerateMode,
            previousMessages,
            previousUpdatedAt,
            userMessageId: resolvedUserMessageId,
            writePermitTime,
            newlyBoundFileIds,
          });
        };

        try {
          const sendHeartbeat = () => {
            try { if (!clientAborted) controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`)); } catch { /* ignore */ }
          };
          heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
          sendHeartbeat();

          const sendEvent = (payload) => {
            const padding = !paddingSent ? SSE_PADDING : "";
            paddingSent = true;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
          };

          const pushCitations = (items) => {
            if (pushUniqueCitations(citations, items)) {
              sendEvent({ type: "citations", citations });
            }
          };

          const systemPrompt = await buildDirectChatSystemPrompt({
            userSystemPrompt, systemPromptSuffix, enableWebSearch, searchContextSection: "",
          });

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
              searchContextTokens += estimateTokens(toolExecution.outputText);
              if (toolExecution.result?.success === false) {
                throw new Error(toolExecution.outputText || "联网搜索失败");
              }
              return toolExecution.outputText;
            },
          });
          finalUsage = result.usage || null;
          finalProviderState = result.providerState || null;
          if (searchContextTokens > 0) {
            sendEvent({ type: "search_context_tokens", tokens: searchContextTokens });
          }

          if (clientAborted) {
            await rollbackCurrentTurn();
            try { controller.close(); } catch { /* ignore */ }
            return;
          }

          fullText = fullText.trim();
          fullThought = fullThought.trim();

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));

          if (user && currentConversationId) {
            const providerState = finalProviderState
              ? { ...finalProviderState, usage: finalUsage }
              : (finalUsage ? { usage: finalUsage } : undefined);
            const modelMessage = {
              id: resolvedModelMessageId,
              role: "model",
              content: fullText,
              thought: fullThought,
              type: "text",
              parts: [{ text: fullText }],
              ...(toolRecords.length > 0 ? { tools: toolRecords } : {}),
              ...(citations.length > 0 ? { citations } : {}),
              ...(searchContextTokens > 0 ? { searchContextTokens } : {}),
              ...(providerState ? { providerState } : {}),
            };
            const persistedConversation = await Conversation.findOneAndUpdate(
              buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
              { $push: { messages: modelMessage }, updatedAt: new Date() },
              { new: true }
            ).select("updatedAt");
            if (!persistedConversation) {
              const conflictError = new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
              conflictError.status = 409;
              throw conflictError;
            }
            finalMessagePersisted = true;
            writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();
            if (removedFileIdsAfterRegenerate.length > 0) {
              await deleteStoredFilesByIds({
                userId: user.userId,
                fileIds: removedFileIdsAfterRegenerate,
                ownerType: "conversation",
                ownerId: currentConversationId,
              });
            }
          }
          controller.close();
        } catch (err) {
          const error = normalizeProviderError(err);
          if (clientAborted) {
            try { await rollbackCurrentTurn(); } catch { /* ignore */ }
            try { controller.close(); } catch { /* ignore */ }
            return;
          }
          try { await rollbackCurrentTurn(); } catch { /* ignore */ }
          try {
            const errorPayload = JSON.stringify({ type: "stream_error", message: error?.message || "Unknown error" });
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
