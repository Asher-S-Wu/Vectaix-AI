import Conversation from '@/models/Conversation';
import {
    fetchBlobAsBase64,
    fetchImageAsBase64,
    estimateTokens,
    generateMessageId,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
} from '@/app/api/chat/utils';
import { buildBytedanceInputFromHistory, buildSeedMessageInput } from '@/app/api/bytedance/bytedanceHelpers';
import {
    SEED_MODEL_ID,
    isSeedModel,
    normalizeModelId,
} from '@/lib/shared/models';
import { resolveSeedProviderConfig } from '@/lib/modelRoutes';
import {
    buildDirectChatSystemPrompt,
    buildForcedFinalAnswerInstructions,
} from '@/lib/server/chat/systemPromptBuilder';
import {
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
import {
    buildSeedRequestBody,
    extractSeedFunctionCalls,
    extractSeedResponseReasoning,
    extractSeedResponseText,
    normalizeSeedChunkText,
    normalizeSeedOutputItems,
} from '@/lib/server/seed/service';
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
    createWebBrowsingRuntime,
    executeWebBrowsingNativeToolCall,
    getOpenAIWebTools,
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
import { consumeStrictResponsesStream } from '@/lib/server/chat/responsesStream';
import { fetchWithZenmuxRateLimit } from '@/lib/server/providers/zenmuxRateLimit';
import {
    buildSseResponseHeaders,
    ensureConversationForChatRequest,
    persistRegenerateConversationMessages,
    persistUserConversationMessage,
    requireChatUser,
    validateChatRequestBody,
} from '@/lib/server/chat/routeHelpers';
import { assertRequestSize, parseJsonRequest } from '@/lib/server/api/routeHelpers';

const SEED_UPSTREAM_DEBUG_SAMPLE_LIMIT = 12;

function findLatestSeedResponseId(messages) {
    if (!Array.isArray(messages)) return '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const responseId = typeof message?.providerState?.seed?.responseId === 'string'
            ? message.providerState.seed.responseId.trim()
            : '';
        if (responseId) return responseId;
    }
    return '';
}

function buildSeedTraceId() {
    return `seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateSeedLogText(value, max = 240) {
    const text = normalizeSeedChunkText(value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
}

function summarizeSeedEvent(event) {
    const eventType = typeof event?.type === 'string' ? event.type : 'unknown';
    const responsePayload = event?.response;

    return {
        type: eventType,
        keys: event && typeof event === 'object' ? Object.keys(event).slice(0, 10) : [],
        textPreview: truncateSeedLogText(event?.delta),
        reasoningPreview: '',
        completedTextPreview: truncateSeedLogText(extractSeedResponseText(responsePayload)),
        responseId: typeof responsePayload?.id === 'string' ? responsePayload.id : '',
    };
}

function createSeedUpstreamDebugSession(meta) {
    const eventTypes = {};
    const samples = [];
    let parseErrorCount = 0;
    let sawDone = false;

    const pushSample = (sample) => {
        if (samples.length >= SEED_UPSTREAM_DEBUG_SAMPLE_LIMIT) return;
        samples.push(sample);
    };

    return {
        start(extra = {}) {
            console.log('[Seed upstream debug] start', JSON.stringify({ ...meta, ...extra }));
        },
        recordEvent(event) {
            const summary = summarizeSeedEvent(event);
            eventTypes[summary.type] = (eventTypes[summary.type] || 0) + 1;
            pushSample(summary);
        },
        recordParseError(raw) {
            parseErrorCount += 1;
            pushSample({
                type: 'parse_error',
                rawPreview: typeof raw === 'string' ? raw.slice(0, 400) : '',
            });
        },
        markDone() {
            sawDone = true;
        },
        finish(extra = {}) {
            console.log('[Seed upstream debug] summary', JSON.stringify({
                ...meta,
                ...extra,
                sawDone,
                parseErrorCount,
                eventTypes,
                samples,
            }));
        },
        fail(error, extra = {}) {
            console.error('[Seed upstream debug] error', JSON.stringify({
                ...meta,
                ...extra,
                sawDone,
                parseErrorCount,
                eventTypes,
                samples,
                error: {
                    message: error?.message || 'Unknown error',
                    status: typeof error?.status === 'number' ? error.status : null,
                    name: error?.name || '',
                    code: error?.code || '',
                },
            }));
        },
    };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
    let writePermitTime = null;
    const seedTraceId = buildSeedTraceId();

    try {
        const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
        if (oversizeResponse) return oversizeResponse;

        const parsed = await parseJsonRequest(req, 'Invalid JSON in request body');
        if (!parsed.ok) return parsed.response;
        const body = parsed.body;

        const {
            prompt,
            model,
            config,
            history,
            historyLimit,
            conversationId,
            mode,
            messages,
            settings,
            userMessageId,
            modelMessageId,
        } = body;

        const invalidBodyResponse = validateChatRequestBody(body);
        if (invalidBodyResponse) return invalidBodyResponse;

        const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
        if (authResult?.response) return authResult.response;
        const user = authResult.auth;

        const { baseUrl: seedBaseUrl, apiKey } = resolveSeedProviderConfig();

        const conversationModel = normalizeModelId(model);
        const apiModel = conversationModel;
        if (!isSeedModel(conversationModel)) {
            return Response.json({ error: '当前接口仅支持官方 Seed 模型' }, { status: 400 });
        }

        let seedInput = [];
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
            } catch (error) {
                return Response.json({ error: error?.message || 'messages invalid' }, { status: 400 });
            }

            sanitized = await enrichStoredMessagesWithBlobIds(sanitized, { userId: user.userId });
            const persisted = await persistRegenerateConversationMessages({
                conversationId,
                userId: user.userId,
                messages: sanitized,
            });
            const conv = persisted?.conversation;

            if (!conv) {
                return Response.json({ error: 'Not found' }, { status: 404 });
            }

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
            expectedProvider: 'seed',
            prompt,
            fallbackTitle: isNonEmptyString(prompt)
                ? prompt
                : ((Array.isArray(config?.attachments) && config.attachments[0]?.name) || 'New Chat'),
            model: conversationModel,
            settings,
            webSearch: config?.webSearch,
        });

        if (isRegenerateMode) {
            const effectiveMessages = (limit > 0 && Number.isFinite(limit))
                ? storedMessagesForRegenerate.slice(-limit)
                : storedMessagesForRegenerate;
            const historyBeforeCurrentPrompt = Array.isArray(storedMessagesForRegenerate)
                && storedMessagesForRegenerate[storedMessagesForRegenerate.length - 1]?.role === 'user'
                ? storedMessagesForRegenerate.slice(0, -1)
                : storedMessagesForRegenerate;
            effectiveHistoryMessages = (limit > 0 && Number.isFinite(limit))
                ? historyBeforeCurrentPrompt.slice(-limit)
                : historyBeforeCurrentPrompt;
            seedInput = await buildBytedanceInputFromHistory(effectiveMessages);
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit))
                ? safeHistory.slice(-limit)
                : safeHistory;
            effectiveHistoryMessages = effectiveHistory;
            seedInput = await buildBytedanceInputFromHistory(effectiveHistory);
        }

        const attachmentEntries = Array.isArray(config?.attachments)
            ? config.attachments.filter((item) => {
                const inputType = getAttachmentInputType(item?.category);
                return (inputType === 'video' || inputType === 'audio') && isNonEmptyString(item?.url);
            })
            : [];
        const dbImageEntries = [];
        if (!isRegenerateMode) {
            const userContent = [];
            if (isNonEmptyString(prompt)) {
                userContent.push({ type: 'input_text', text: prompt });
            }

            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (!img?.url) continue;
                    const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                    userContent.push({
                        type: 'input_image',
                        image_url: `data:${mimeType};base64,${base64Data}`,
                    });
                    dbImageEntries.push({ url: img.url, mimeType });
                }
            }

            for (const attachment of attachmentEntries) {
                const inputType = getAttachmentInputType(attachment.category);
                const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(attachment.url, {
                    resourceLabel: inputType || 'media',
                });
                const mimeType = attachment.mimeType || fetchedMimeType;
                if (inputType === 'video') {
                    userContent.push({
                        type: 'input_video',
                        video_url: `data:${mimeType};base64,${base64Data}`,
                    });
                    continue;
                }
                if (inputType === 'audio') {
                    userContent.push({
                        type: 'input_audio',
                        audio_url: `data:${mimeType};base64,${base64Data}`,
                    });
                }
            }

            if (userContent.length === 0) {
                return Response.json({ error: '请至少输入内容或上传附件' }, { status: 400 });
            }

            const userMessageInput = buildSeedMessageInput({ role: 'user', content: userContent });
            if (userMessageInput) {
                seedInput.push(userMessageInput);
            }
        }

        let maxTokens;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }
        const webSearchConfig = parseWebSearchConfig(config?.webSearch);
        const enableWebSearch = parseWebSearchEnabled(config?.webSearch);
        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
        const currentTurnInput = !isRegenerateMode && seedInput.length > 0
            ? seedInput[seedInput.length - 1]
            : null;
        const latestSeedResponseId = isRegenerateMode ? '' : findLatestSeedResponseId(effectiveHistoryMessages);

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
                content: typeof prompt === 'string' ? prompt : '',
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
        } catch { }

        let paddingSent = false;
        let heartbeatTimer = null;

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = '';
                let fullThought = '';
                const citations = [];
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
                        } catch { }
                    };

                    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                    sendHeartbeat();

                    const sendEvent = (payload) => {
                        const padding = !paddingSent ? SSE_PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}${padding}\n\n`));
                    };

                    const pushCitations = (items) => {
                        for (const item of items) {
                            if (!item?.url || seenUrls.has(item.url)) continue;
                            seenUrls.add(item.url);
                            citations.push({ url: item.url, title: item.title });
                        }
                    };

                    const instructions = await buildDirectChatSystemPrompt({
                        userSystemPrompt,
                        systemPromptSuffix,
                        enableWebSearch,
                        searchContextSection: '',
                    });
                    const requestSeedStream = async (requestBody, onThought, onText) => {
                        const url = `${seedBaseUrl}/responses`;
                        const upstreamDebug = createSeedUpstreamDebugSession({
                            traceId: seedTraceId,
                            conversationId: currentConversationId || '',
                            model: apiModel || SEED_MODEL_ID,
                        });
                        upstreamDebug.start({
                            previousResponseId: typeof requestBody?.previous_response_id === 'string' ? requestBody.previous_response_id : '',
                            inputCount: Array.isArray(requestBody?.input) ? requestBody.input.length : 0,
                            hasTools: Array.isArray(requestBody?.tools) && requestBody.tools.length > 0,
                            toolTypes: Array.isArray(requestBody?.tools)
                                ? requestBody.tools.map((tool) => tool?.type || tool?.name || 'unknown').slice(0, 8)
                                : [],
                            maxOutputTokens: Number.isFinite(requestBody?.max_output_tokens) ? requestBody.max_output_tokens : null,
                            thinkingType: requestBody?.thinking?.type || '',
                            reasoningEffort: requestBody?.reasoning?.effort || '',
                        });
                        let response = await fetchWithZenmuxRateLimit(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                            },
                            body: JSON.stringify({ ...requestBody, stream: true }),
                            signal: req?.signal,
                        }, {
                            label: `ark:seed:${apiModel}`,
                        });
                        if (!response.ok && (response.status === 502 || response.status === 503 || response.status === 504)) {
                            await new Promise((resolve) => setTimeout(resolve, 800));
                            response = await fetchWithZenmuxRateLimit(url, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify({ ...requestBody, stream: true }),
                                signal: req?.signal,
                            }, {
                                label: `ark:seed:${apiModel}`,
                            });
                        }
                        if (!response.ok) {
                            const errorText = await response.text();
                            upstreamDebug.fail(new Error(`Seed APIError: ${response.status} ${errorText}`), {
                                upstreamStatus: response.status,
                                contentType: response.headers.get('content-type') || '',
                                rawErrorPreview: typeof errorText === 'string' ? errorText.slice(0, 600) : '',
                            });
                            throw new Error(`Seed APIError: ${response.status} ${errorText}`);
                        }

                        let streamedText = '';

                        try {
                            const finalPayload = await consumeStrictResponsesStream({
                                response,
                                signal: req?.signal,
                                normalizeText: normalizeSeedChunkText,
                                onEvent: (event) => {
                                    upstreamDebug.recordEvent(event);
                                },
                                onParseError: (dataStr) => {
                                    upstreamDebug.recordParseError(dataStr);
                                },
                                onDone: () => {
                                    upstreamDebug.markDone();
                                },
                                onThoughtDelta: (text) => {
                                    onThought?.(text);
                                },
                                onTextDelta: (text) => {
                                    streamedText += text;
                                    onText?.(text);
                                },
                                missingCompletedMessage: 'Seed 上游缺少 response.completed 事件',
                            });
                            upstreamDebug.finish({
                                upstreamStatus: response.status,
                                contentType: response.headers.get('content-type') || '',
                                streamedTextLength: streamedText.length,
                                finalTextLength: extractSeedResponseText(finalPayload).length,
                                finalTextPreview: truncateSeedLogText(extractSeedResponseText(finalPayload), 400),
                                finalResponseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                            });

                            return finalPayload;
                        } catch (error) {
                            upstreamDebug.fail(error, {
                                upstreamStatus: response.status,
                                contentType: response.headers.get('content-type') || '',
                                streamedTextLength: streamedText.length,
                            });
                            throw error;
                        }
                    };

                    const usePreviousResponseId = Boolean(latestSeedResponseId && currentTurnInput);
                    let nextInput = usePreviousResponseId ? [currentTurnInput] : seedInput;
                    let previousResponseId = usePreviousResponseId ? latestSeedResponseId : '';
                    let finalPayload = null;
                    const toolRecords = [];
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const roundController = enableWebSearch
                        ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
                        : null;
                    const maxPasses = enableWebSearch ? getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS) : 1;

                    for (let pass = 0; pass < maxPasses; pass += 1) {
                        const availableToolApiNames = enableWebSearch ? roundController.getAvailableToolApiNames() : [];
                        const requestBody = buildSeedRequestBody({
                            model: apiModel || SEED_MODEL_ID,
                            input: nextInput,
                            instructions,
                            maxTokens,
                            thinkingLevel: 'high',
                            stream: true,
                        });
                        requestBody.store = true;
                        if (previousResponseId) {
                            requestBody.previous_response_id = previousResponseId;
                        }
                        if (enableWebSearch && availableToolApiNames.length > 0) {
                            requestBody.tools = getOpenAIWebTools(availableToolApiNames);
                        }

                        const payload = await requestSeedStream(requestBody, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        });
                        if (clientAborted) break;

                        const thought = extractSeedResponseReasoning(payload);
                        if (thought) {
                            fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                        }

                        const functionCalls = enableWebSearch ? extractSeedFunctionCalls(payload) : [];
                        if (functionCalls.length === 0) {
                            finalPayload = payload;
                            fullText = extractSeedResponseText(payload);
                            break;
                        }

                        previousResponseId = typeof payload?.id === 'string' ? payload.id : previousResponseId;
                        nextInput = [];
                        const selectedFunctionCalls = [];
                        const selectedFunctionCallRounds = [];
                        for (const functionCall of functionCalls.slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND)) {
                            const toolReservation = roundController?.reserve(functionCall.name);
                            if (!toolReservation?.allowed) continue;
                            selectedFunctionCalls.push(functionCall);
                            selectedFunctionCallRounds.push(toolReservation.round);
                        }
                        if (selectedFunctionCalls.length === 0) {
                            break;
                        }

                        for (let functionCallIndex = 0; functionCallIndex < selectedFunctionCalls.length; functionCallIndex += 1) {
                            const functionCall = selectedFunctionCalls[functionCallIndex];
                            const toolExecution = await executeWebBrowsingNativeToolCall({
                                apiName: functionCall.name,
                                argumentsInput: functionCall.arguments,
                                runtime,
                                sendEvent,
                                pushCitations,
                                round: selectedFunctionCallRounds[functionCallIndex] || 1,
                                signal: req?.signal,
                            });
                            toolRecords.push(toolExecution.toolRecord);
                            nextInput.push({
                                type: 'function_call_output',
                                call_id: functionCall.call_id,
                                output: toolExecution.outputText,
                            });
                        }
                    }

                    const shouldForceFinalAnswer = enableWebSearch
                        && !finalPayload
                        && !clientAborted
                        && previousResponseId
                        && Array.isArray(nextInput)
                        && nextInput.length > 0;

                    if (shouldForceFinalAnswer) {
                        const requestBody = buildSeedRequestBody({
                            model: apiModel || SEED_MODEL_ID,
                            input: nextInput,
                            instructions: buildForcedFinalAnswerInstructions(instructions),
                            maxTokens,
                            thinkingLevel: 'high',
                            stream: true,
                        });
                        requestBody.store = true;
                        requestBody.previous_response_id = previousResponseId;

                        const payload = await requestSeedStream(requestBody, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        });
                        if (!clientAborted) {
                            const thought = extractSeedResponseReasoning(payload);
                            if (thought) {
                                fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                            }
                            finalPayload = payload;
                            fullText = extractSeedResponseText(payload);
                        }
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (!finalPayload && !clientAborted) {
                        throw new Error('Seed 工具循环未返回最终答案');
                    }

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { }
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
                            parts: [{ text: fullText }],
                            providerState: finalPayload
                                ? {
                                    seed: {
                                        responseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                                        output: normalizeSeedOutputItems(finalPayload?.output),
                                    },
                                }
                                : null,
                        };

                        const persistedConversation = await Conversation.findOneAndUpdate(
                            buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
                            {
                                $push: { messages: modelMessage },
                                updatedAt: Date.now(),
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
                } catch (error) {
                    if (clientAborted) {
                        try { await rollbackCurrentTurn(); } catch { }
                        try { controller.close(); } catch { }
                        return;
                    }

                    try { await rollbackCurrentTurn(); } catch { }
                    try {
                        const errorPayload = JSON.stringify({
                            type: 'stream_error',
                            message: error?.message || 'Unknown error',
                        });
                        const padding = !paddingSent ? SSE_PADDING : '';
                        paddingSent = true;
                        controller.enqueue(encoder.encode(`data: ${errorPayload}${padding}\n\n`));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    } catch {
                        controller.error(error);
                    }
                } finally {
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                    try {
                        req?.signal?.removeEventListener?.('abort', onAbort);
                    } catch { }
                }
            }
        });

        return new Response(responseStream, { headers: buildSseResponseHeaders(currentConversationId) });
    } catch (error) {
        console.error('Seed API Error:', {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            code: error?.code,
        });

        const rawStatus = typeof error?.status === 'number' ? error.status : 500;
        const status = rawStatus === 401 ? 500 : rawStatus;
        let errorMessage = error?.message;

        if (rawStatus === 401) {
            errorMessage = 'Seed 接口认证失败，请检查 ARK_API_KEY';
        } else if (error?.message?.includes('ARK_API_KEY')) {
            errorMessage = 'Seed 接口未正确配置，请检查 ARK_API_KEY';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
