import Anthropic from "@anthropic-ai/sdk";
import Conversation from '@/models/Conversation';
import {
    getDefaultMaxTokensForModel,
    getModelConfig,
    isClaudeOpusModel,
} from '@/lib/shared/models';
import {
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessagesStrict,
    generateMessageId,
    estimateTokens
} from '@/app/api/chat/utils';
import { getAttachmentInputType } from '@/lib/shared/attachments';
import {
    CONVERSATION_WRITE_CONFLICT_ERROR,
    buildConversationWriteCondition,
    rollbackConversationTurn,
} from '@/app/api/chat/conversationState';
import {
    enrichConversationPartsWithBlobIds,
    enrichStoredMessagesWithBlobIds,
} from '@/lib/server/conversations/blobReferences';
import {
    buildAttachmentTextBlock,
    prepareDocumentAttachmentMapByUrls,
} from '@/lib/server/files/service';
import { buildDirectChatSystemPrompt } from '@/lib/server/chat/systemPromptBuilder';
import {
    clampMaxTokens,
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import {
    isClaudeModel,
    resolveAnthropicApiModel,
    resolveAnthropicProviderConfig,
} from '@/lib/server/chat/providerAdapters';
import {
    createWebBrowsingRuntime,
    executeWebBrowsingNativeToolCall,
    getAnthropicWebTools,
    WEB_BROWSING_MAX_ROUNDS,
    WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND,
} from '@/lib/server/webBrowsing/nativeTools';
import {
    createWebBrowsingRoundController,
    getMaxWebBrowsingModelPasses,
} from '@/lib/server/webBrowsing/roundControl';
import {
    CHAT_RATE_LIMIT,
    MAX_REQUEST_BYTES,
    SSE_PADDING,
    HEARTBEAT_INTERVAL_MS,
} from '@/lib/server/chat/routeConstants';
import { createZenmuxAwareFetch } from '@/lib/server/providers/zenmuxRateLimit';
import {
    buildSseResponseHeaders,
    ensureConversationForChatRequest,
    persistRegenerateConversationMessages,
    persistUserConversationMessage,
    requireChatUser,
    validateChatRequestBody,
} from '@/lib/server/chat/routeHelpers';
import { assertRequestSize, parseJsonRequest } from '@/lib/server/api/routeHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function storedPartToClaudePart(part, options = {}) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        return { type: 'text', text: part.text };
    }

    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
        const mimeType = part.inlineData?.mimeType;
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Data
            }
        };
    }

    const fileUrl = part?.fileData?.url;
    if (isNonEmptyString(fileUrl)) {
        const fileTextMap = options?.fileTextMap instanceof Map ? options.fileTextMap : new Map();
        const prepared = fileTextMap.get(fileUrl);
        const extractedText = prepared?.structuredText || prepared?.extractedText || '';
        if (isNonEmptyString(extractedText)) {
            return {
                type: 'text',
                text: buildAttachmentTextBlock(prepared.file || part.fileData, extractedText),
            };
        }
    }

    return null;
}

async function buildClaudeMessagesFromHistory(messages, options = {}) {
    const claudeMessages = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        if (msg.role === 'model' && Array.isArray(msg?.providerState?.anthropic?.content) && msg.providerState.anthropic.content.length > 0) {
            claudeMessages.push({
                role: 'assistant',
                content: msg.providerState.anthropic.content,
            });
            continue;
        }

        const storedParts = getStoredPartsFromMessage(msg);
        if (!storedParts || storedParts.length === 0) continue;

        const content = [];
        for (const storedPart of storedParts) {
            const p = await storedPartToClaudePart(storedPart, options);
            if (p) content.push(p);
        }
        if (content.length) {
            claudeMessages.push({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content
            });
        }
    }
    return claudeMessages;
}

function normalizeAnthropicAssistantContent(content) {
    if (!Array.isArray(content)) return [];
    return content
        .map((block) => {
            if (!block || typeof block !== 'object') return null;
            if (block.type === 'thinking') {
                return {
                    type: 'thinking',
                    thinking: typeof block.thinking === 'string' ? block.thinking : '',
                    signature: typeof block.signature === 'string' ? block.signature : '',
                };
            }
            if (block.type === 'text') {
                return {
                    type: 'text',
                    text: typeof block.text === 'string' ? block.text : '',
                };
            }
            if (block.type === 'tool_use') {
                return {
                    type: 'tool_use',
                    id: typeof block.id === 'string' ? block.id : '',
                    name: typeof block.name === 'string' ? block.name : '',
                    input: block.input && typeof block.input === 'object' ? block.input : {},
                };
            }
            return null;
        })
        .filter(Boolean);
}

function limitAnthropicToolUseBlocks(content) {
    let remaining = WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND;
    return (Array.isArray(content) ? content : []).filter((block) => {
        if (block?.type !== 'tool_use') return true;
        if (remaining <= 0) return false;
        remaining -= 1;
        return true;
    });
}

function extractAnthropicResponseState(content) {
    const safeContent = limitAnthropicToolUseBlocks(content);
    const toolUses = [];
    let fullThought = '';
    let fullText = '';

    for (const block of safeContent) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
            fullThought += block.thinking;
            continue;
        }
        if (block.type === 'text' && typeof block.text === 'string') {
            fullText += block.text;
            continue;
        }
        if (block.type === 'tool_use') {
            toolUses.push(block);
        }
    }

    return {
        fullText: fullText.trim(),
        fullThought: fullThought.trim(),
        toolUses: toolUses.slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND),
        storedContent: normalizeAnthropicAssistantContent(safeContent),
    };
}

export async function POST(req) {
    let writePermitTime = null;

    try {
        const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
        if (oversizeResponse) return oversizeResponse;

        const parsed = await parseJsonRequest(req, 'Invalid JSON in request body');
        if (!parsed.ok) return parsed.response;
        const body = parsed.body;

        const { prompt, model, config, history, historyLimit, conversationId, mode, messages, settings, userMessageId, modelMessageId } = body;

        const invalidBodyResponse = validateChatRequestBody(body);
        if (invalidBodyResponse) return invalidBodyResponse;

        const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
        if (authResult?.response) return authResult.response;
        const user = authResult.auth;

        const supportedAnthropicModel = isClaudeModel(model);
        if (!supportedAnthropicModel) {
            return Response.json({ error: 'unsupported anthropic-compatible model' }, { status: 400 });
        }

        const providerConfig = await resolveAnthropicProviderConfig(model);
        const { baseUrl: anthropicBaseUrl, apiKey } = providerConfig;
        const apiModel = resolveAnthropicApiModel(model);
        const client = new Anthropic({
            apiKey,
            baseURL: anthropicBaseUrl,
            fetch: createZenmuxAwareFetch({ label: `zenmux:claude:${apiModel}` }),
        });

        const currentAttachments = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => getAttachmentInputType(item?.category) === 'file' && isNonEmptyString(item?.url))
            : [];
        let claudeMessages = [];
        let effectiveHistoryMessages = [];
        const limit = Number.parseInt(historyLimit, 10);
        if (!Number.isFinite(limit) || limit < 0) {
            return Response.json({ error: 'historyLimit invalid' }, { status: 400 });
        }
        const isRegenerateMode = mode === 'regenerate' && user && conversationId && Array.isArray(messages);
        let storedMessagesForRegenerate = null;
        const resolvedUserMessageId = (typeof userMessageId === 'string' && userMessageId.trim())
            ? userMessageId.trim()
            : generateMessageId();
        const resolvedModelMessageId = (typeof modelMessageId === 'string' && modelMessageId.trim())
            ? modelMessageId.trim()
            : generateMessageId();

        if (isRegenerateMode) {
            let sanitized;
            try {
                sanitized = sanitizeStoredMessagesStrict(messages);
            } catch (e) {
                return Response.json({ error: e?.message || 'messages invalid' }, { status: 400 });
            }
            sanitized = await enrichStoredMessagesWithBlobIds(sanitized, { userId: user.userId });
            const persisted = await persistRegenerateConversationMessages({
                conversationId,
                userId: user.userId,
                messages: sanitized,
            });
            const conv = persisted?.conversation;
            if (!conv) return Response.json({ error: 'Not found' }, { status: 404 });
            storedMessagesForRegenerate = sanitized;
            writePermitTime = persisted.writePermitTime;
        }

        const {
            currentConversationId,
            currentConversation,
            createdConversationForRequest,
            previousMessages,
            previousUpdatedAt,
        } = await ensureConversationForChatRequest({
            userId: user.userId,
            conversationId: conversationId || null,
            expectedProvider: getModelConfig(model)?.provider,
            prompt,
            fallbackTitle: isNonEmptyString(prompt)
                ? prompt
                : ((Array.isArray(config?.attachments) && config.attachments[0]?.name) || ((Array.isArray(config?.images) && config.images.length > 0) ? '图片对话' : 'New Chat')),
            model,
            settings,
            webSearch: config?.webSearch,
        });

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            const historyBeforeCurrentPrompt = Array.isArray(msgs) && msgs[msgs.length - 1]?.role === 'user'
                ? msgs.slice(0, -1)
                : msgs;
            effectiveHistoryMessages = (limit > 0 && Number.isFinite(limit))
                ? historyBeforeCurrentPrompt.slice(-limit)
                : historyBeforeCurrentPrompt;
            const historyAttachmentUrls = effectiveMsgs.flatMap((msg) =>
                Array.isArray(msg?.parts)
                    ? msg.parts
                        .map((part) => part?.fileData)
                        .filter((file) => getAttachmentInputType(file?.category) === 'file' && isNonEmptyString(file?.url))
                        .map((file) => file.url)
                    : []
            );
            const historyFileTextMap = await prepareDocumentAttachmentMapByUrls(historyAttachmentUrls, {
                userId: user.userId,
                conversationId: currentConversationId,
                signal: req?.signal,
            });
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveMsgs, { fileTextMap: historyFileTextMap });
        } else {
            // 非 regenerate 模式：历史消息也需要正确处理图片
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? history.slice(-limit) : history;
            effectiveHistoryMessages = effectiveHistory;
            const historyAttachmentUrls = effectiveHistory.flatMap((msg) =>
                Array.isArray(msg?.parts)
                    ? msg.parts
                        .map((part) => part?.fileData)
                        .filter((file) => getAttachmentInputType(file?.category) === 'file' && isNonEmptyString(file?.url))
                        .map((file) => file.url)
                    : []
            );
            const historyFileTextMap = await prepareDocumentAttachmentMapByUrls(historyAttachmentUrls, {
                userId: user.userId,
                conversationId: currentConversationId,
                signal: req?.signal,
            });
            claudeMessages = await buildClaudeMessagesFromHistory(effectiveHistory, { fileTextMap: historyFileTextMap });
        }

        // 在历史消息的最后一条添加缓存控制，使对话历史可被缓存
        if (claudeMessages.length > 0) {
            const lastHistoryMsg = claudeMessages[claudeMessages.length - 1];
            if (lastHistoryMsg.content?.length > 0) {
                const lastContent = lastHistoryMsg.content[lastHistoryMsg.content.length - 1];
                lastContent.cache_control = { type: "ephemeral", ttl: "1h" };
            }
        }

        let dbImageEntries = [];
        let attachmentEntries = [];

        if (!isRegenerateMode) {
            const userContent = [];

            if (isNonEmptyString(prompt)) {
                userContent.push({ type: 'text', text: prompt });
            }

            // 支持多张图片
            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        userContent.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: base64Data
                            }
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
            }

            if (currentAttachments.length > 0) {
                const preparedAttachments = await prepareDocumentAttachmentMapByUrls(
                    currentAttachments.map((item) => item.url),
                    {
                        userId: user.userId,
                        conversationId: currentConversationId,
                        signal: req?.signal,
                    }
                );
                attachmentEntries = currentAttachments.filter((item) => preparedAttachments.has(item.url));
                for (const attachment of attachmentEntries) {
                    const prepared = preparedAttachments.get(attachment.url);
                    const extractedText = prepared?.structuredText || prepared?.extractedText || '';
                    if (!isNonEmptyString(extractedText)) continue;
                    userContent.push({
                        type: 'text',
                        text: buildAttachmentTextBlock(prepared.file || attachment, extractedText),
                    });
                }
            }

            if (userContent.length === 0) {
                return Response.json({ error: '请至少输入内容或上传附件' }, { status: 400 });
            }

            claudeMessages.push({ role: 'user', content: userContent });
        }

        // 构建请求参数（联网搜索上下文将在流式开始前注入）
        let maxTokens;
        const modelConfig = getModelConfig(model);
        const supportsMaxTokensControl = modelConfig?.supportsMaxTokensControl === true;
        const maxTokenCap = isClaudeOpusModel(model) ? 128000 : 64000;
        try {
            maxTokens = supportsMaxTokensControl
                ? parseMaxTokens(config?.maxTokens)
                : getDefaultMaxTokensForModel(model);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }
        const normalizedMaxTokens = clampMaxTokens(maxTokens, maxTokenCap);
        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);

        // 是否启用联网搜索
        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

        if (user && !isRegenerateMode) {
            const storedUserParts = [];
            if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });

            if (dbImageEntries.length > 0) {
                for (const entry of dbImageEntries) {
                    storedUserParts.push({
                        inlineData: {
                            mimeType: entry.mimeType,
                            url: entry.url,
                        },
                    });
                }
            }

            if (attachmentEntries.length > 0) {
                for (const attachment of attachmentEntries) {
                    storedUserParts.push({
                        fileData: {
                            url: attachment.url,
                            name: attachment.name,
                            mimeType: attachment.mimeType,
                            size: attachment.size,
                            extension: attachment.extension,
                            category: attachment.category,
                        },
                    });
                }
            }

            const enrichedStoredUserParts = await enrichConversationPartsWithBlobIds(storedUserParts, {
                userId: user.userId,
            });
            const userMessage = {
                id: resolvedUserMessageId,
                role: 'user',
                content: prompt,
                type: 'parts',
                parts: enrichedStoredUserParts,
            };
            const persisted = await persistUserConversationMessage({
                conversationId: currentConversationId,
                userId: user.userId,
                userMessage,
            });
            const updatedConv = persisted?.conversation;
            if (!updatedConv) {
                return Response.json({ error: 'Not found' }, { status: 404 });
            }
            writePermitTime = persisted.writePermitTime;
        }

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => { clientAborted = true; };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch { /* ignore */ }

        let paddingSent = false;
        let heartbeatTimer = null;

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = "";
                let fullThought = "";
                let citations = [];
                let searchContextTokens = 0;
                const seenUrls = new Set();
                let finalMessagePersisted = false;

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
                    });
                };

                try {
                    const sendHeartbeat = () => {
                        try {
                            if (clientAborted) return;
                            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
                        } catch { /* ignore */ }
                    };
                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? SSE_PADDING : '';
                        paddingSent = true;
                        const data = `data: ${JSON.stringify(payload)}${padding}\n\n`;
                        controller.enqueue(encoder.encode(data));
                    };

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url || seenUrls.has(item.url)) continue;
                            seenUrls.add(item.url);
                            citations.push({ url: item.url, title: item.title });
                        }
                    };

                    const systemPrompt = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection: '',
                    });
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const workingMessages = [...claudeMessages];
                    const toolRecords = [];
                    let storedAssistantContent = [];
                    let finished = false;
                    const roundController = enableWebSearch
                        ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
                        : null;
                    const maxPasses = enableWebSearch ? getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS) : 1;

                    for (let pass = 0; pass < maxPasses; pass += 1) {
                        const availableToolApiNames = enableWebSearch ? roundController.getAvailableToolApiNames() : [];
                        const requestParams = {
                            model: apiModel,
                            max_tokens: normalizedMaxTokens,
                            system: [
                                {
                                    type: "text",
                                    text: systemPrompt,
                                    cache_control: {
                                        type: "ephemeral",
                                        ttl: "1h"
                                    }
                                }
                            ],
                            messages: workingMessages,
                            ...(enableWebSearch && availableToolApiNames.length > 0 ? { tools: getAnthropicWebTools(availableToolApiNames) } : {}),
                        };

                        if (isClaudeModel(model)) {
                            requestParams.thinking = { type: "adaptive", display: "summarized" };
                            requestParams.output_config = {
                                effort: 'max'
                            };
                        }

                        const stream = await client.messages.stream(requestParams);
                        if (clientAborted) break;

                        let responseContent = [];
                        let stopReason = null;

                        for await (const event of stream) {
                            if (clientAborted) break;

                            if (event.type === 'content_block_delta') {
                                if (event.delta?.type === 'thinking_delta' && event.delta?.thinking) {
                                    sendEvent({ type: 'thought', content: event.delta.thinking });
                                } else if (event.delta?.type === 'text_delta' && event.delta?.text) {
                                    sendEvent({ type: 'text', content: event.delta.text });
                                }
                            } else if (event.type === 'content_block_start') {
                                responseContent.push(event.content_block);
                            } else if (event.type === 'content_block_stop') {
                                // Content block completed
                            } else if (event.type === 'message_delta') {
                                if (event.delta?.stop_reason) {
                                    stopReason = event.delta.stop_reason;
                                }
                            }
                        }

                        const finalMessage = await stream.finalMessage();
                        responseContent = finalMessage.content || responseContent;
                        stopReason = finalMessage.stop_reason || stopReason;

                        const state = extractAnthropicResponseState(responseContent);
                        if (state.fullThought) {
                            fullThought = fullThought ? `${fullThought}\n\n${state.fullThought}` : state.fullThought;
                        }

                        if (!enableWebSearch || state.toolUses.length === 0 || stopReason !== 'tool_use') {
                            fullText = state.fullText;
                            storedAssistantContent = state.storedContent;
                            finished = true;
                            break;
                        }

                        workingMessages.push({ role: 'assistant', content: state.storedContent });
                        const toolResultBlocks = [];
                        const selectedToolUses = [];
                        const selectedToolUseRounds = [];
                        for (const toolUse of state.toolUses.slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND)) {
                            const toolReservation = roundController?.reserve(toolUse?.name);
                            if (!toolReservation?.allowed) continue;
                            selectedToolUses.push(toolUse);
                            selectedToolUseRounds.push(toolReservation.round);
                        }
                        if (selectedToolUses.length === 0) {
                            break;
                        }

                        for (let toolUseIndex = 0; toolUseIndex < selectedToolUses.length; toolUseIndex += 1) {
                            const toolUse = selectedToolUses[toolUseIndex];
                            const toolExecution = await executeWebBrowsingNativeToolCall({
                                apiName: toolUse?.name,
                                argumentsInput: toolUse?.input,
                                runtime,
                                sendEvent,
                                pushCitations,
                                round: selectedToolUseRounds[toolUseIndex] || 1,
                                signal: req?.signal,
                            });
                            toolRecords.push(toolExecution.toolRecord);
                            toolResultBlocks.push({
                                type: 'tool_result',
                                tool_use_id: toolUse.id,
                                content: toolExecution.outputText,
                            });
                        }
                        workingMessages.push({ role: 'user', content: toolResultBlocks });
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (!finished && !clientAborted) {
                        throw new Error('Anthropic 工具循环未返回最终答案');
                    }

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    // 发送引用信息
                    if (citations.length > 0) {
                        const citationsData = `data: ${JSON.stringify({ type: 'citations', citations })}\n\n`;
                        controller.enqueue(encoder.encode(citationsData));
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    if (user && currentConversationId) {
                        const modelMessage = {
                            id: resolvedModelMessageId,
                            role: 'model',
                            content: fullText,
                            thought: fullThought,
                            citations: citations.length > 0 ? citations : null,
                            tools: enableWebSearch && toolRecords.length > 0 ? toolRecords : null,
                            searchContextTokens: searchContextTokens || null,
                            type: 'text',
                            parts: [{ text: fullText }],
                            providerState: {
                                anthropic: {
                                    content: storedAssistantContent,
                                },
                            },
                        };
                        const persistedConversation = await Conversation.findOneAndUpdate(
                            buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
                            {
                                $push: {
                                    messages: modelMessage
                                },
                                updatedAt: Date.now()
                            },
                            { new: true }
                        ).select('updatedAt');
                        if (!persistedConversation) {
                            const conflictError = new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
                            conflictError.status = 409;
                            throw conflictError;
                        }
                        finalMessagePersisted = true;
                        writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();
                    }
                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        try { await rollbackCurrentTurn(); } catch { /* ignore */ }
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }
                    // 将错误作为 SSE 事件发送给客户端（而非 controller.error），保留原始错误信息
                    try { await rollbackCurrentTurn(); } catch { /* ignore */ }
                    try {
                        const errorPayload = JSON.stringify({ type: 'stream_error', message: err?.message || 'Unknown error' });
                        const padding = !paddingSent ? SSE_PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${errorPayload}${padding}\n\n`));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    } catch {
                        controller.error(err);
                    }
                } finally {
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                    try {
                        req?.signal?.removeEventListener?.('abort', onAbort);
                    } catch { /* ignore */ }
                }
            }
        });

        return new Response(responseStream, { headers: buildSseResponseHeaders(currentConversationId) });

    } catch (error) {
        console.error("Anthropic-compatible API Error:", {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            code: error?.code
        });

        const rawStatus = typeof error?.status === 'number' ? error.status : 500;
        const isUpstreamAuthError = rawStatus === 401;
        const status = isUpstreamAuthError ? 500 : rawStatus;
        let errorMessage = error?.message;

        if (isUpstreamAuthError) {
            errorMessage = '模型服务认证失败，请检查接口配置';
        } else if (error?.message?.includes('API_KEY')) {
            errorMessage = "API configuration error. Please check your API keys.";
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
