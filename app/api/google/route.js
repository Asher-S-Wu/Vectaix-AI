import Conversation from '@/models/Conversation';
import {
    fetchBlobAsBase64,
    fetchImageAsBase64,
    isNonEmptyString,
    getStoredPartsFromMessage,
    sanitizeStoredMessagesStrict,
    generateMessageId,
    estimateTokens
} from '@/app/api/chat/utils';
import { getAttachmentInputType } from '@/lib/shared/attachments';
import {
    buildAttachmentTextBlock,
    prepareDocumentAttachmentMapByUrls,
} from '@/lib/server/files/service';
import {
    CONVERSATION_WRITE_CONFLICT_ERROR,
    buildConversationWriteCondition,
    rollbackConversationTurn,
} from '@/app/api/chat/conversationState';
import {
    enrichConversationPartsWithBlobIds,
    enrichStoredMessagesWithBlobIds,
} from '@/lib/server/conversations/blobReferences';
import { resolveGeminiProviderConfig } from '@/lib/modelRoutes';
import { buildDirectChatSystemPrompt } from '@/lib/server/chat/systemPromptBuilder';
import {
    clampMaxTokens,
    parseGeminiThinkingLevel,
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import { createGeminiClient, resolveGeminiApiModel } from '@/lib/server/chat/providerAdapters';
import {
    createWebBrowsingRuntime,
    executeWebBrowsingNativeToolCall,
    getGeminiWebTools,
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

async function storedPartToRequestPart(part, options = {}) {
    if (!part || typeof part !== 'object') return null;

    if (isNonEmptyString(part.text)) {
        const p = { text: part.text };
        if (part.thought === true) p.thought = true;
        if (isNonEmptyString(part.thoughtSignature)) p.thoughtSignature = part.thoughtSignature;
        return p;
    }

    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
        const mimeType = part.inlineData?.mimeType || fetchedMimeType;
        const p = { inlineData: { mimeType, data: base64Data } };
        if (isNonEmptyString(part.thoughtSignature)) p.thoughtSignature = part.thoughtSignature;
        return p;
    }

    const fileUrl = part?.fileData?.url;
    const inputType = getAttachmentInputType(part?.fileData?.category);
    if (isNonEmptyString(fileUrl) && inputType === 'file') {
        const fileTextMap = options?.fileTextMap instanceof Map ? options.fileTextMap : new Map();
        const prepared = fileTextMap.get(fileUrl);
        const extractedText = prepared?.structuredText || prepared?.extractedText || '';
        if (isNonEmptyString(extractedText)) {
            return { text: buildAttachmentTextBlock(prepared.file || part.fileData, extractedText) };
        }
    }
    if (isNonEmptyString(fileUrl) && (inputType === 'video' || inputType === 'audio')) {
        const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(fileUrl, { resourceLabel: inputType });
        const mimeType = part.fileData?.mimeType || fetchedMimeType;
        return { inlineData: { mimeType, data: base64Data } };
    }

    return null;
}

async function buildGeminiContentsFromMessages(messages, options = {}) {
    const contents = [];
    for (const msg of messages) {
        if (msg?.role !== 'user' && msg?.role !== 'model') continue;

        const storedParts = getStoredPartsFromMessage(msg, { includeThoughtSignature: true });
        if (!storedParts || storedParts.length === 0) continue;
        const parts = [];
        for (const storedPart of storedParts) {
            const p = await storedPartToRequestPart(storedPart, options);
            if (p) parts.push(p);
        }
        if (parts.length) contents.push({ role: msg.role, parts });
    }
    return contents;
}

function extractGeminiResponseState(parts) {
    const safeParts = Array.isArray(parts) ? parts : [];
    const functionCalls = [];
    const storedModelParts = [];
    let fullText = '';
    let fullThought = '';

    for (const part of safeParts) {
        if (!part || typeof part !== 'object') continue;

        if (part.functionCall && typeof part.functionCall === 'object') {
            functionCalls.push(part.functionCall);
            continue;
        }

        const text = typeof part.text === 'string' ? part.text : '';
        if (!text) continue;

        const storedPart = { text };
        if (part.thought === true) storedPart.thought = true;
        if (isNonEmptyString(part.thoughtSignature)) storedPart.thoughtSignature = part.thoughtSignature;
        storedModelParts.push(storedPart);

        if (part.thought === true) {
            fullThought += text;
        } else {
            fullText += text;
        }
    }

    return {
        functionCalls,
        storedModelParts,
        fullText: fullText.trim(),
        fullThought: fullThought.trim(),
    };
}

function buildGeminiHistoryPartFromChunk(part) {
    if (!part || typeof part !== 'object') return null;

    if (part.functionCall && typeof part.functionCall === 'object') {
        const nextPart = {
            functionCall: part.functionCall,
        };
        if (part.thought === true) nextPart.thought = true;
        if (isNonEmptyString(part.thoughtSignature)) nextPart.thoughtSignature = part.thoughtSignature;
        return nextPart;
    }

    if (typeof part.text === 'string' && part.text) {
        const nextPart = { text: part.text };
        if (part.thought === true) nextPart.thought = true;
        if (isNonEmptyString(part.thoughtSignature)) nextPart.thoughtSignature = part.thoughtSignature;
        return nextPart;
    }

    return null;
}

function getGeminiFunctionCallIdentity(part) {
    if (!part?.functionCall || typeof part.functionCall !== 'object') return '';
    const functionCall = part.functionCall;
    const args = functionCall?.args && typeof functionCall.args === 'object'
        ? JSON.stringify(functionCall.args)
        : '';
    return `${functionCall?.id || ''}::${functionCall?.name || ''}::${args}`;
}

function mergeGeminiHistoryPart(existingPart, nextPart) {
    if (!existingPart || typeof existingPart !== 'object') return nextPart;
    if (!nextPart || typeof nextPart !== 'object') return existingPart;
    return {
        ...existingPart,
        ...nextPart,
        thoughtSignature: isNonEmptyString(nextPart?.thoughtSignature)
            ? nextPart.thoughtSignature
            : existingPart.thoughtSignature,
    };
}

function filterGeminiHistoryParts(parts, functionCalls) {
    const selectedIdentities = new Set(
        (Array.isArray(functionCalls) ? functionCalls : []).map((item) => getGeminiFunctionCallIdentity({ functionCall: item }))
    );
    return (Array.isArray(parts) ? parts : []).filter((part) => {
        if (!part?.functionCall) return true;
        return selectedIdentities.has(getGeminiFunctionCallIdentity(part));
    });
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

        const apiModel = resolveGeminiApiModel(model);
        const providerConfig = resolveGeminiProviderConfig();
        const ai = await createGeminiClient();
        let contents = [];
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
            expectedProvider: 'gemini',
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
            contents = await buildGeminiContentsFromMessages(effectiveMsgs, { fileTextMap: historyFileTextMap });
        } else {
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
            contents = await buildGeminiContentsFromMessages(effectiveHistory, { fileTextMap: historyFileTextMap });
        }

        const mediaAttachmentEntries = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => {
                const inputType = getAttachmentInputType(item?.category);
                return (inputType === 'video' || inputType === 'audio') && isNonEmptyString(item?.url);
            })
            : [];
        const documentAttachmentEntries = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => getAttachmentInputType(item?.category) === 'file' && isNonEmptyString(item?.url))
            : [];
        let currentParts = isRegenerateMode ? null : [];
        let dbImageEntries = [];
        const dbAttachmentEntries = [];

        if (!isRegenerateMode && isNonEmptyString(prompt)) {
            currentParts.push({ text: prompt });
        }

        if (!isRegenerateMode && config?.images?.length > 0) {
            for (const img of config.images) {
                if (img?.url) {
                    const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                    currentParts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        },
                        ...(config.mediaResolution ? { mediaResolution: { level: config.mediaResolution } } : {})
                    });
                    dbImageEntries.push({ url: img.url, mimeType });
                }
            }
        }

        if (!isRegenerateMode && mediaAttachmentEntries.length > 0) {
            for (const attachment of mediaAttachmentEntries) {
                const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(attachment.url, {
                    resourceLabel: getAttachmentInputType(attachment.category) || 'media',
                });
                const mimeType = attachment.mimeType || fetchedMimeType;
                currentParts.push({
                    inlineData: {
                        mimeType,
                        data: base64Data,
                    },
                });
                dbAttachmentEntries.push(attachment);
            }
        }

        if (!isRegenerateMode && documentAttachmentEntries.length > 0) {
            const preparedAttachments = await prepareDocumentAttachmentMapByUrls(
                documentAttachmentEntries.map((item) => item.url),
                {
                    userId: user.userId,
                    conversationId: currentConversationId,
                    signal: req?.signal,
                }
            );
            for (const attachment of documentAttachmentEntries) {
                const prepared = preparedAttachments.get(attachment.url);
                const extractedText = prepared?.structuredText || prepared?.extractedText || '';
                if (!isNonEmptyString(extractedText)) continue;
                currentParts.push({ text: buildAttachmentTextBlock(prepared.file || attachment, extractedText) });
                dbAttachmentEntries.push(attachment);
            }
        }

        if (!isRegenerateMode && currentParts.length === 0) {
            return Response.json({ error: '请至少输入内容或上传附件' }, { status: 400 });
        }

        if (!isRegenerateMode) {
            contents.push({
                role: "user",
                parts: currentParts
            });
        }

        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
        const generationConfig = (config?.generationConfig && typeof config.generationConfig === 'object' && !Array.isArray(config.generationConfig))
            ? config.generationConfig
            : {};
        const safeGenerationConfig = { ...generationConfig };
        delete safeGenerationConfig.temperature;
        let maxTokens;
        let thinkingLevel;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
            thinkingLevel = parseGeminiThinkingLevel(config?.thinkingLevel ?? "high");
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }

        const baseConfig = {
            ...safeGenerationConfig,
            temperature: 1.0,
            maxOutputTokens: clampMaxTokens(maxTokens, 65536),
            thinkingConfig: {
                thinkingLevel,
                includeThoughts: true
            }
        };

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

            if (dbAttachmentEntries.length > 0) {
                for (const attachment of dbAttachmentEntries) {
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
                parts: enrichedStoredUserParts
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
        } catch {
            // ignore
        }

        let paddingSent = false;
        let heartbeatTimer = null;

        const stream = new ReadableStream({
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
                        } catch {
                            // ignore
                        }
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

                    const finalSystemPrompt = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection: '',
                    });
                    const finalConfig = {
                        ...baseConfig,
                        systemInstruction: {
                            parts: [{ text: finalSystemPrompt }]
                        }
                    };
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const workingContents = [...contents];
                    const toolRecords = [];
                    let storedModelParts = [];
                    let finished = false;
                    const roundController = enableWebSearch
                        ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
                        : null;
                    const maxPasses = enableWebSearch ? getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS) : 1;

                    for (let pass = 0; pass < maxPasses; pass += 1) {
                        const availableToolApiNames = enableWebSearch ? roundController.getAvailableToolApiNames() : [];
                        const response = await ai.models.generateContentStream({
                            model: apiModel,
                            contents: workingContents,
                            config: enableWebSearch && availableToolApiNames.length > 0
                                ? { ...finalConfig, tools: getGeminiWebTools(availableToolApiNames) }
                                : finalConfig,
                        });

                        let roundFullText = '';
                        let roundFullThought = '';
                        let roundFunctionCalls = [];
                        const roundHistoryParts = [];
                        const functionCallIndexes = new Map();

                        for await (const chunk of response) {
                            if (clientAborted) break;

                            const candidate = Array.isArray(chunk?.candidates) ? chunk.candidates[0] : null;
                            const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

                            for (const part of parts) {
                                if (!part || typeof part !== 'object') continue;

                                if (part.functionCall && typeof part.functionCall === 'object') {
                                    const functionCallIdentity = getGeminiFunctionCallIdentity(part);
                                    const historyPart = buildGeminiHistoryPartFromChunk(part);
                                    if (!functionCallIdentity || !functionCallIndexes.has(functionCallIdentity)) {
                                        if (functionCallIdentity) {
                                            functionCallIndexes.set(functionCallIdentity, roundHistoryParts.length);
                                        }
                                        roundFunctionCalls.push(part.functionCall);
                                        if (historyPart) roundHistoryParts.push(historyPart);
                                    } else if (historyPart) {
                                        const historyIndex = functionCallIndexes.get(functionCallIdentity);
                                        if (Number.isInteger(historyIndex) && historyIndex >= 0) {
                                            roundHistoryParts[historyIndex] = mergeGeminiHistoryPart(
                                                roundHistoryParts[historyIndex],
                                                historyPart
                                            );
                                        }
                                    }
                                    continue;
                                }

                                const historyPart = buildGeminiHistoryPartFromChunk(part);
                                if (historyPart) roundHistoryParts.push(historyPart);

                                const text = typeof part.text === 'string' ? part.text : '';
                                if (!text) continue;

                                if (part.thought === true) {
                                    roundFullThought += text;
                                    sendEvent({ type: 'thought', content: text });
                                } else {
                                    roundFullText += text;
                                    sendEvent({ type: 'text', content: text });
                                }
                            }
                        }

                        if (clientAborted) break;

                        if (roundFullThought.trim()) {
                            fullThought = fullThought ? `${fullThought}\n\n${roundFullThought.trim()}` : roundFullThought.trim();
                        }

                        if (!enableWebSearch || roundFunctionCalls.length === 0) {
                            fullText = roundFullText;
                            storedModelParts = fullText ? [{ text: fullText }] : [];
                            finished = true;
                            break;
                        }

                        const selectedFunctionCalls = [];
                        const selectedFunctionCallRounds = [];
                        for (const functionCall of roundFunctionCalls.slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND)) {
                            const toolReservation = roundController?.reserve(functionCall?.name);
                            if (!toolReservation?.allowed) continue;
                            selectedFunctionCalls.push(functionCall);
                            selectedFunctionCallRounds.push(toolReservation.round);
                        }
                        if (selectedFunctionCalls.length === 0) {
                            break;
                        }

                        const selectedHistoryParts = filterGeminiHistoryParts(roundHistoryParts, selectedFunctionCalls);
                        const lastParts = selectedHistoryParts.length > 0
                            ? selectedHistoryParts
                            : [
                                ...(roundFullText ? [{ text: roundFullText }] : []),
                                ...selectedFunctionCalls.map((fc) => ({ functionCall: fc })),
                            ];
                        workingContents.push({ role: 'model', parts: lastParts });
                        const functionResponseParts = [];
                        for (let functionCallIndex = 0; functionCallIndex < selectedFunctionCalls.length; functionCallIndex += 1) {
                            const functionCall = selectedFunctionCalls[functionCallIndex];
                            const toolExecution = await executeWebBrowsingNativeToolCall({
                                apiName: functionCall?.name,
                                argumentsInput: functionCall?.args,
                                runtime,
                                sendEvent,
                                pushCitations,
                                round: selectedFunctionCallRounds[functionCallIndex] || 1,
                                signal: req?.signal,
                            });
                            toolRecords.push(toolExecution.toolRecord);
                            functionResponseParts.push({
                                functionResponse: {
                                    name: functionCall.name,
                                    response: {
                                        result: toolExecution.outputText,
                                    },
                                    ...(isNonEmptyString(functionCall?.id) ? { id: functionCall.id } : {}),
                                },
                            });
                        }
                        workingContents.push({ role: 'user', parts: functionResponseParts });
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (!finished && !clientAborted) {
                        throw new Error('Gemini 工具循环未返回最终答案');
                    }

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    if (citations.length > 0) {
                        sendEvent({ type: 'citations', citations });
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
                            parts: storedModelParts.length > 0 ? storedModelParts : [{ text: fullText }]
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
                    } catch {
                        // ignore
                    }
                }
            }
        });

        return new Response(stream, { headers: buildSseResponseHeaders(currentConversationId) });

    } catch (error) {
        console.error("Gemini API Error:", {
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
        } else if (error?.message?.includes('ECONNREFUSED')) {
            errorMessage = "Failed to connect to external service.";
        } else if (error?.message?.includes('fetch')) {
            errorMessage = "Failed to fetch external resource.";
        }

        return Response.json(
            {
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
            },
            { status }
        );
    }
}
