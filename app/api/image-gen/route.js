import { put } from '@vercel/blob';
import Conversation from '@/models/Conversation';
import BlobFile from '@/models/BlobFile';
import {
    fetchImageAsBase64,
    generateMessageId,
    isNonEmptyString,
} from '@/app/api/chat/utils';
import { resolveImageGenProviderConfig } from '@/lib/modelRoutes';
import {
    CONVERSATION_WRITE_CONFLICT_ERROR,
    buildConversationWriteCondition,
    rollbackConversationTurn,
} from '@/app/api/chat/conversationState';
import {
    enrichConversationPartsWithBlobIds,
} from '@/lib/server/conversations/blobReferences';
import dbConnect from '@/lib/db';
import {
    buildSseResponseHeaders,
    ensureConversationForChatRequest,
    persistUserConversationMessage,
    requireChatUser,
} from '@/lib/server/chat/routeHelpers';
import { assertRequestSize, parseJsonRequest } from '@/lib/server/api/routeHelpers';
import {
    CHAT_RATE_LIMIT,
    MAX_REQUEST_BYTES,
    SSE_PADDING,
    HEARTBEAT_INTERVAL_MS,
} from '@/lib/server/chat/routeConstants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_POLL_ITERATIONS = 120;
const POLL_INTERVAL_MS = 3000;

const VALID_SIZES = new Set([
    'auto', '1:1', '3:2', '2:3', '4:3', '3:4',
    '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21',
]);

const VALID_RESOLUTIONS = new Set(['1k', '2k', '4k']);

function normalizeSize(size) {
    if (typeof size === 'string' && VALID_SIZES.has(size)) return size;
    return '1:1';
}

function normalizeResolution(resolution) {
    if (typeof resolution === 'string' && VALID_RESOLUTIONS.has(resolution)) return resolution;
    return '1k';
}

export async function POST(req) {
    let writePermitTime = null;

    try {
        const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
        if (oversizeResponse) return oversizeResponse;

        const parsed = await parseJsonRequest(req, 'Invalid JSON in request body');
        if (!parsed.ok) return parsed.response;
        const body = parsed.body;

        const { prompt, model, config, conversationId, settings, userMessageId, modelMessageId } = body;

        if (!model || typeof model !== 'string') {
            return Response.json({ error: 'Model is required' }, { status: 400 });
        }
        if (typeof prompt !== 'string' || !prompt.trim()) {
            return Response.json({ error: '请输入图片描述' }, { status: 400 });
        }

        const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
        if (authResult?.response) return authResult.response;
        const user = authResult.auth;

        const { baseUrl: apiBaseUrl, apiKey } = resolveImageGenProviderConfig();

        const size = normalizeSize(config?.size);
        const resolution = normalizeResolution(config?.resolution);

        const {
            currentConversationId,
            createdConversationForRequest,
            previousMessages,
            previousUpdatedAt,
        } = await ensureConversationForChatRequest({
            userId: user.userId,
            conversationId: conversationId || null,
            expectedProvider: 'image-gen',
            prompt,
            fallbackTitle: prompt,
            model,
            settings,
        });

        const resolvedUserMessageId = (typeof userMessageId === 'string' && userMessageId.trim())
            ? userMessageId.trim()
            : generateMessageId();
        const resolvedModelMessageId = (typeof modelMessageId === 'string' && modelMessageId.trim())
            ? modelMessageId.trim()
            : generateMessageId();

        // 持久化用户消息
        const storedUserParts = [];
        if (isNonEmptyString(prompt)) storedUserParts.push({ text: prompt });

        const imageUrls = [];
        if (Array.isArray(config?.images) && config.images.length > 0) {
            for (const img of config.images) {
                if (img?.url) {
                    storedUserParts.push({
                        inlineData: {
                            mimeType: img.mimeType || 'image/png',
                            url: img.url,
                        },
                    });
                    const { base64Data, mimeType } = await fetchImageAsBase64(img.url);
                    imageUrls.push(`data:${mimeType};base64,${base64Data}`);
                }
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
        if (!persisted?.conversation) {
            return Response.json({ error: 'Not found' }, { status: 404 });
        }
        writePermitTime = persisted.writePermitTime;

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
                let finalMessagePersisted = false;

                const rollbackCurrentTurn = async () => {
                    if (finalMessagePersisted) return;
                    await rollbackConversationTurn({
                        conversationId: currentConversationId,
                        userId: user.userId,
                        createdConversationForRequest,
                        isRegenerateMode: false,
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

                    // 提交生成任务
                    const genBody = {
                        model: 'gpt-image-2',
                        prompt: prompt.trim(),
                        n: 1,
                        size,
                        resolution,
                    };
                    if (imageUrls.length > 0) {
                        genBody.image_urls = imageUrls;
                    }

                    const submitRes = await fetch(`${apiBaseUrl}/images/generations`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(genBody),
                        signal: req?.signal,
                    });

                    if (!submitRes.ok) {
                        let errorMessage = '图片生成任务提交失败';
                        try {
                            const errData = await submitRes.json();
                            if (errData?.error?.message) errorMessage = errData.error.message;
                            else if (errData?.message) errorMessage = errData.message;
                        } catch { /* ignore */ }
                        throw new Error(errorMessage);
                    }

                    const submitData = await submitRes.json();
                    const taskId = submitData?.data?.[0]?.task_id;
                    if (!taskId) {
                        throw new Error('未获取到任务 ID');
                    }

                    sendEvent({ type: 'image_gen_start', taskId });

                    // 轮询任务结果
                    let imageUrl = null;
                    for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
                        if (clientAborted) break;

                        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

                        if (clientAborted) break;

                        const pollRes = await fetch(`${apiBaseUrl}/tasks/${taskId}`, {
                            headers: { 'Authorization': `Bearer ${apiKey}` },
                            signal: req?.signal,
                        });

                        if (!pollRes.ok) {
                            throw new Error(`查询任务状态失败（${pollRes.status}）`);
                        }

                        const pollData = await pollRes.json();
                        const status = pollData?.data?.status;
                        const progress = pollData?.data?.progress;

                        if (status === 'completed') {
                            imageUrl = pollData?.data?.result?.images?.[0]?.url?.[0];
                            if (!imageUrl) {
                                throw new Error('图片生成完成但未返回图片地址');
                            }
                            break;
                        }

                        if (status === 'failed') {
                            const failMsg = pollData?.data?.error?.message || '图片生成失败';
                            throw new Error(failMsg);
                        }

                        sendEvent({
                            type: 'image_gen_progress',
                            status: status || 'pending',
                            progress: typeof progress === 'number' ? progress : 0,
                        });
                    }

                    if (clientAborted) {
                        await rollbackCurrentTurn();
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }

                    if (!imageUrl) {
                        throw new Error('图片生成超时，请稍后重试');
                    }

                    // 下载生成的图片并上传到 Vercel Blob
                    let blobUrl = imageUrl;
                    try {
                        const imgRes = await fetch(imageUrl);
                        if (!imgRes.ok) throw new Error(`下载图片失败（${imgRes.status}）`);
                        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                        const contentType = imgRes.headers.get('content-type') || 'image/png';
                        const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
                        const pathname = `image-gen/${user.userId}/${currentConversationId}/${resolvedModelMessageId}.${ext}`;
                        const blob = await put(pathname, imgBuffer, {
                            access: 'public',
                            addRandomSuffix: false,
                            contentType,
                        });
                        blobUrl = blob.url;

                        await dbConnect();
                        await BlobFile.findOneAndUpdate(
                            { url: blob.url },
                            {
                                $setOnInsert: {
                                    userId: user.userId,
                                    url: blob.url,
                                    pathname: blob.pathname,
                                    originalName: `${resolvedModelMessageId}.${ext}`,
                                    mimeType: contentType,
                                    size: imgBuffer.length,
                                    extension: ext,
                                    category: 'image',
                                    kind: 'chat',
                                    parseStatus: 'ready',
                                    createdAt: new Date(),
                                },
                            },
                            { upsert: true },
                        );
                    } catch (blobErr) {
                        console.error('[ImageGen] Blob upload failed, using original URL:', blobErr?.message);
                    }

                    sendEvent({ type: 'image_gen_complete', imageUrl: blobUrl });
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    // 持久化模型消息
                    const modelMessage = {
                        id: resolvedModelMessageId,
                        role: 'model',
                        content: '',
                        type: 'parts',
                        parts: [{ inlineData: { url: blobUrl, mimeType: 'image/png' } }],
                    };
                    const persistedConversation = await Conversation.findOneAndUpdate(
                        buildConversationWriteCondition(currentConversationId, user.userId, writePermitTime),
                        {
                            $push: { messages: modelMessage },
                            updatedAt: Date.now(),
                        },
                        { new: true },
                    ).select('updatedAt');
                    if (!persistedConversation) {
                        const conflictError = new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
                        conflictError.status = 409;
                        throw conflictError;
                    }
                    finalMessagePersisted = true;

                    controller.close();
                } catch (err) {
                    if (clientAborted) {
                        try { await rollbackCurrentTurn(); } catch { /* ignore */ }
                        try { controller.close(); } catch { /* ignore */ }
                        return;
                    }
                    try { await rollbackCurrentTurn(); } catch { /* ignore */ }
                    try {
                        const errorPayload = JSON.stringify({ type: 'stream_error', message: err?.message || '图片生成失败' });
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
        console.error('[ImageGen] API error:', {
            status: error?.status,
            name: error?.name,
        });

        const rawStatus = typeof error?.status === 'number' ? error.status : 500;
        const isUpstreamAuthError = rawStatus === 401;
        const status = isUpstreamAuthError ? 500 : rawStatus;
        let errorMessage = error?.message;

        if (isUpstreamAuthError) {
            errorMessage = '图片生成服务认证失败，请检查接口配置';
        }

        return Response.json({ error: errorMessage }, { status });
    }
}
