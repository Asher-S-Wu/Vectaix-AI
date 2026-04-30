import Conversation from '@/models/Conversation';
import {
    fetchImageAsBase64,
    generateMessageId,
    isNonEmptyString,
    sanitizeStoredMessagesStrict,
    estimateTokens,
} from '@/app/api/chat/utils';
import { DEEPSEEK_V4_PRO_MODEL } from '@/lib/shared/models';
import { resolveDeepSeekProviderConfig } from '@/lib/modelRoutes';
import {
    buildDirectChatSystemPrompt,
    buildForcedFinalAnswerInstructions,
} from '@/lib/server/chat/systemPromptBuilder';
import {
    clampMaxTokens,
    parseMaxTokens,
    parseSystemPrompt,
    parseWebSearchConfig,
    parseWebSearchEnabled,
} from '@/lib/server/chat/requestConfig';
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
import {
    buildResponsesInputFromHistory,
    extractOpenAIFunctionCalls,
    extractOpenAIResponseReasoning,
    extractOpenAIResponseText,
    normalizeOpenAIOutputItems,
} from '@/app/api/openai/openaiHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEEPSEEK_UPSTREAM_DEBUG_SAMPLE_LIMIT = 12;

function buildDeepSeekTraceId() {
    return `deepseek_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDeepSeekChunkText(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item.text === 'string') return item.text;
                if (item && typeof item.content === 'string') return item.content;
                return '';
            })
            .join('');
    }
    if (value && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        if (typeof value.content === 'string') return value.content;
    }
    return '';
}

function truncateDeepSeekLogText(value, max = 240) {
    const text = normalizeDeepSeekChunkText(value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
}

function summarizeDeepSeekEvent(event) {
    const eventType = typeof event?.type === 'string' ? event.type : 'unknown';
    const responsePayload = event?.response;

    return {
        type: eventType,
        keys: event && typeof event === 'object' ? Object.keys(event).slice(0, 10) : [],
        deltaPreview: truncateDeepSeekLogText(event?.delta ?? event?.text ?? event?.part),
        responseId: typeof responsePayload?.id === 'string' ? responsePayload.id : '',
        outputIndex: Number.isInteger(event?.output_index) ? event.output_index : null,
    };
}

function createDeepSeekUpstreamDebugSession(meta) {
    const eventTypes = {};
    const samples = [];
    let parseErrorCount = 0;
    let sawDone = false;

    const pushSample = (sample) => {
        if (samples.length >= DEEPSEEK_UPSTREAM_DEBUG_SAMPLE_LIMIT) return;
        samples.push(sample);
    };

    return {
        start(extra = {}) {
            console.info('[DeepSeek upstream debug] start', JSON.stringify({ ...meta, ...extra }));
        },
        recordEvent(event) {
            const summary = summarizeDeepSeekEvent(event);
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
            console.info('[DeepSeek upstream debug] summary', JSON.stringify({
                ...meta,
                ...extra,
                sawDone,
                parseErrorCount,
                eventTypes,
                samples,
            }));
        },
        fail(error, extra = {}) {
            console.error('[DeepSeek upstream debug] error', JSON.stringify({
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

export async function POST(req) {
    let writePermitTime = null;
    const deepSeekTraceId = buildDeepSeekTraceId();

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

        const { baseUrl: deepseekBaseUrl, apiKey } = resolveDeepSeekProviderConfig();
        const apiModel = DEEPSEEK_V4_PRO_MODEL;

        let deepseekInput = [];
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
            expectedProvider: 'deepseek',
            prompt,
            fallbackTitle: prompt || 'New Chat',
            model,
            settings,
            webSearch: config?.webSearch,
        });

        if (isRegenerateMode) {
            const msgs = storedMessagesForRegenerate;
            const effectiveMsgs = (limit > 0 && Number.isFinite(limit)) ? msgs.slice(-limit) : msgs;
            deepseekInput = await buildResponsesInputFromHistory(effectiveMsgs, { providerStateKey: 'deepseek' });
        } else {
            const safeHistory = Array.isArray(history) ? history : [];
            const effectiveHistory = (limit > 0 && Number.isFinite(limit)) ? safeHistory.slice(-limit) : safeHistory;
            deepseekInput = await buildResponsesInputFromHistory(effectiveHistory, { providerStateKey: 'deepseek' });
        }

        let dbImageEntries = [];

        if (!isRegenerateMode) {
            const userContent = [];
            if (isNonEmptyString(prompt)) {
                userContent.push({ type: 'input_text', text: prompt });
            }
            if (config?.images?.length > 0) {
                for (const img of config.images) {
                    if (img?.url) {
                        const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                        userContent.push({
                            type: 'input_image',
                            image_url: `data:${mimeType};base64,${base64Data}`,
                        });
                        dbImageEntries.push({ url: img.url, mimeType });
                    }
                }
            }
            deepseekInput.push({ role: 'user', content: userContent });
        }

        let maxTokens;
        try {
            maxTokens = parseMaxTokens(config?.maxTokens);
        } catch (error) {
            return Response.json({ error: error?.message || '配置无效' }, { status: 400 });
        }

        const userSystemPrompt = parseSystemPrompt(config?.systemPrompt);
        const systemPromptSuffix = parseSystemPrompt(config?.systemPromptSuffix);
        const baseInput = Array.isArray(deepseekInput) ? deepseekInput : [];
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

        console.info('[DeepSeek debug] request', JSON.stringify({
            traceId: deepSeekTraceId,
            conversationId: currentConversationId || '',
            model: apiModel,
            mode: isRegenerateMode ? 'regenerate' : 'chat',
            enableWebSearch,
            promptLength: prompt.length,
            historyCount: Array.isArray(history) ? history.length : 0,
            inputCount: Array.isArray(baseInput) ? baseInput.length : 0,
            imageCount: dbImageEntries.length,
            maxTokens: clampMaxTokens(maxTokens, 64000),
        }));

        const encoder = new TextEncoder();
        let clientAborted = false;
        const onAbort = () => {
            clientAborted = true;
            console.warn('[DeepSeek debug] client aborted', JSON.stringify({
                traceId: deepSeekTraceId,
                conversationId: currentConversationId || '',
                model: apiModel,
            }));
        };
        try {
            req?.signal?.addEventListener?.('abort', onAbort, { once: true });
        } catch { }

        let paddingSent = false;
        let heartbeatTimer = null;

        const responseStream = new ReadableStream({
            async start(controller) {
                let fullText = '';
                let fullThought = '';
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
                        } catch { }
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
                    const runtime = createWebBrowsingRuntime({ webSearchOptions: webSearchConfig });
                    const toolRecords = [];
                    const requestResponsesStream = async (requestBody, onThought, onText, debugMeta = {}) => {
                        const upstreamDebug = createDeepSeekUpstreamDebugSession({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            model: apiModel,
                            ...debugMeta,
                        });
                        upstreamDebug.start({
                            inputCount: Array.isArray(requestBody?.input) ? requestBody.input.length : 0,
                            hasTools: Array.isArray(requestBody?.tools) && requestBody.tools.length > 0,
                            toolTypes: Array.isArray(requestBody?.tools)
                                ? requestBody.tools.map((tool) => tool?.type || tool?.name || 'unknown').slice(0, 8)
                                : [],
                            maxOutputTokens: Number.isFinite(requestBody?.max_output_tokens) ? requestBody.max_output_tokens : null,
                        });
                        const request = async () => fetchWithZenmuxRateLimit(`${deepseekBaseUrl}/responses`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify({ ...requestBody, stream: true }),
                            signal: req?.signal,
                        }, {
                            label: `zenmux:deepseek:${apiModel}`,
                        });

                        let response = await request();
                        if (!response.ok && (response.status === 502 || response.status === 503 || response.status === 504)) {
                            await new Promise((resolve) => setTimeout(resolve, 800));
                            response = await request();
                        }
                        if (!response.ok) {
                            const errorText = await response.text();
                            const error = new Error(`DeepSeek API Error: ${response.status} ${errorText}`);
                            upstreamDebug.fail(error, {
                                upstreamStatus: response.status,
                                contentType: response.headers.get('content-type') || '',
                                rawErrorPreview: typeof errorText === 'string' ? errorText.slice(0, 600) : '',
                            });
                            throw error;
                        }

                        let streamedText = '';

                        try {
                            const finalPayload = await consumeStrictResponsesStream({
                                response,
                                signal: req?.signal,
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
                                missingCompletedMessage: 'DeepSeek 上游缺少 response.completed 事件',
                            });
                            upstreamDebug.finish({
                                upstreamStatus: response.status,
                                contentType: response.headers.get('content-type') || '',
                                streamedTextLength: streamedText.length,
                                finalTextLength: extractOpenAIResponseText(finalPayload).length,
                                finalTextPreview: truncateDeepSeekLogText(extractOpenAIResponseText(finalPayload), 400),
                                functionCallCount: extractOpenAIFunctionCalls(finalPayload).length,
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

                    let nextInput = [...baseInput];
                    let finalPayload = null;
                    const roundController = enableWebSearch
                        ? createWebBrowsingRoundController({ maxRounds: WEB_BROWSING_MAX_ROUNDS })
                        : null;
                    const maxPasses = enableWebSearch ? getMaxWebBrowsingModelPasses(WEB_BROWSING_MAX_ROUNDS) : 1;

                    for (let pass = 0; pass < maxPasses; pass += 1) {
                        const availableToolApiNames = enableWebSearch ? roundController.getAvailableToolApiNames() : [];
                        const requestBody = {
                            model: apiModel,
                            stream: false,
                            max_output_tokens: clampMaxTokens(maxTokens, 64000),
                            store: true,
                            reasoning: { effort: 'high' },
                            instructions: finalSystemPrompt,
                            input: nextInput,
                        };
                        if (enableWebSearch && availableToolApiNames.length > 0) {
                            requestBody.tools = getOpenAIWebTools(availableToolApiNames);
                        }

                        console.info('[DeepSeek debug] pass start', JSON.stringify({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            pass: pass + 1,
                            maxPasses,
                            availableToolApiNames,
                            inputCount: Array.isArray(nextInput) ? nextInput.length : 0,
                        }));

                        const payload = await requestResponsesStream(requestBody, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        }, {
                            stage: 'loop',
                            pass: pass + 1,
                        });
                        if (clientAborted) break;

                        const thought = extractOpenAIResponseReasoning(payload);
                        if (thought) {
                            fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                        }

                        const functionCalls = enableWebSearch ? extractOpenAIFunctionCalls(payload) : [];
                        console.info('[DeepSeek debug] pass result', JSON.stringify({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            pass: pass + 1,
                            responseId: typeof payload?.id === 'string' ? payload.id : '',
                            textLength: extractOpenAIResponseText(payload).length,
                            thoughtLength: thought.length,
                            functionCallCount: functionCalls.length,
                        }));
                        if (functionCalls.length === 0) {
                            const passText = extractOpenAIResponseText(payload);
                            if (passText) {
                                finalPayload = payload;
                                fullText = passText;
                                break;
                            }
                            console.warn('[DeepSeek debug] pass returned no text and no function calls', JSON.stringify({
                                traceId: deepSeekTraceId,
                                conversationId: currentConversationId || '',
                                pass: pass + 1,
                                thoughtLength: thought.length,
                            }));
                            break;
                        }

                        const selectedFunctionCalls = [];
                        const selectedFunctionCallRounds = [];
                        for (const functionCall of functionCalls.slice(0, WEB_BROWSING_MAX_TOOL_CALLS_PER_ROUND)) {
                            const toolReservation = roundController?.reserve(functionCall.name);
                            if (!toolReservation?.allowed) continue;
                            selectedFunctionCalls.push(functionCall);
                            selectedFunctionCallRounds.push(toolReservation.round);
                        }
                        if (selectedFunctionCalls.length === 0) {
                            console.warn('[DeepSeek debug] tool calls skipped', JSON.stringify({
                                traceId: deepSeekTraceId,
                                conversationId: currentConversationId || '',
                                pass: pass + 1,
                                requestedToolNames: functionCalls.map((item) => item?.name || '').filter(Boolean),
                            }));
                            break;
                        }

                        const selectedCallIds = new Set(selectedFunctionCalls.map((item) => item.call_id));
                        const responseOutputItems = normalizeOpenAIOutputItems(payload?.output).filter((item) =>
                            item?.type !== 'function_call'
                            || !item?.call_id
                            || selectedCallIds.has(item.call_id)
                        );
                        const toolOutputItems = [];

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
                            console.info('[DeepSeek debug] tool result', JSON.stringify({
                                traceId: deepSeekTraceId,
                                conversationId: currentConversationId || '',
                                pass: pass + 1,
                                round: selectedFunctionCallRounds[functionCallIndex] || 1,
                                apiName: functionCall.name,
                                status: toolExecution?.toolRecord?.status || '',
                                outputLength: typeof toolExecution?.outputText === 'string' ? toolExecution.outputText.length : 0,
                            }));
                            toolOutputItems.push({
                                type: 'function_call_output',
                                call_id: functionCall.call_id,
                                output: toolExecution.outputText,
                            });
                        }

                        nextInput = [
                            ...nextInput,
                            ...responseOutputItems,
                            ...toolOutputItems,
                        ];
                    }

                    const shouldForceFinalAnswer = enableWebSearch
                        && !finalPayload
                        && !clientAborted
                        && Array.isArray(nextInput)
                        && nextInput.length > 0;

                    if (shouldForceFinalAnswer) {
                        console.info('[DeepSeek debug] force final answer', JSON.stringify({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            inputCount: Array.isArray(nextInput) ? nextInput.length : 0,
                            toolRecordCount: toolRecords.length,
                        }));
                        const payload = await requestResponsesStream({
                            model: apiModel,
                            stream: false,
                            max_output_tokens: clampMaxTokens(maxTokens, 64000),
                            store: true,
                            reasoning: { effort: 'high' },
                            instructions: buildForcedFinalAnswerInstructions(finalSystemPrompt),
                            input: nextInput,
                        }, (thought) => {
                            sendEvent({ type: 'thought', content: thought });
                        }, (text) => {
                            sendEvent({ type: 'text', content: text });
                        }, {
                            stage: 'forced_final',
                        });
                        if (!clientAborted) {
                            const thought = extractOpenAIResponseReasoning(payload);
                            if (thought) {
                                fullThought = fullThought ? `${fullThought}\n\n${thought}` : thought;
                            }
                            finalPayload = payload;
                            fullText = extractOpenAIResponseText(payload);
                        }
                    }

                    if (!finalPayload && !clientAborted) {
                        console.error('[DeepSeek debug] missing final payload', JSON.stringify({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            toolRecordCount: toolRecords.length,
                            nextInputCount: Array.isArray(nextInput) ? nextInput.length : 0,
                        }));
                        throw new Error('DeepSeek 工具循环未返回最终答案');
                    }

                    if (enableWebSearch && toolRecords.length > 0) {
                        searchContextTokens = estimateTokens(toolRecords.map((item) => item.content || '').join('\n\n'));
                        if (searchContextTokens > 0) {
                            sendEvent({ type: 'search_context_tokens', tokens: searchContextTokens });
                        }
                    }

                    if (clientAborted) {
                        console.warn('[DeepSeek debug] aborted before completion', JSON.stringify({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            fullTextLength: fullText.length,
                            fullThoughtLength: fullThought.length,
                            toolRecordCount: toolRecords.length,
                        }));
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { }
                        return;
                    }

                    if (citations.length > 0) {
                        const citationsData = `data: ${JSON.stringify({ type: 'citations', citations })}\n\n`;
                        controller.enqueue(encoder.encode(citationsData));
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    // 存储 AI 回复到数据库
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
                                    deepseek: {
                                        responseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                                        output: normalizeOpenAIOutputItems(finalPayload?.output),
                                    },
                                }
                                : null,
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
                    console.info('[DeepSeek debug] completed', JSON.stringify({
                        traceId: deepSeekTraceId,
                        conversationId: currentConversationId || '',
                        responseId: typeof finalPayload?.id === 'string' ? finalPayload.id : '',
                        fullTextLength: fullText.length,
                        fullThoughtLength: fullThought.length,
                        citationCount: citations.length,
                        toolRecordCount: toolRecords.length,
                        searchContextTokens,
                    }));
                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        console.warn('[DeepSeek debug] closed after client abort', JSON.stringify({
                            traceId: deepSeekTraceId,
                            conversationId: currentConversationId || '',
                            message: err?.message || '',
                        }));
                        try { await rollbackCurrentTurn(); } catch { }
                        try { controller.close(); } catch { }
                        return;
                    }
                    console.error('[DeepSeek debug] stream error', JSON.stringify({
                        traceId: deepSeekTraceId,
                        conversationId: currentConversationId || '',
                        message: err?.message || 'Unknown error',
                        name: err?.name || '',
                        status: typeof err?.status === 'number' ? err.status : null,
                        finalMessagePersisted,
                        fullTextLength: fullText.length,
                        fullThoughtLength: fullThought.length,
                        citationCount: citations.length,
                        toolRecordCount: toolRecords.length,
                    }));
                    try { await rollbackCurrentTurn(); } catch { }
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
                    } catch { }
                }
            }
        });

        return new Response(responseStream, { headers: buildSseResponseHeaders(currentConversationId) });

    } catch (error) {
        console.error('DeepSeek API Error:', {
            traceId: deepSeekTraceId,
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
            errorMessage = 'API configuration error. Please check your API keys.';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
