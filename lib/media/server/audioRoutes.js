import mongoose from 'mongoose';
import StoredFile from '@/models/StoredFile';
import ElevenLabsAudioGeneration from '@/models/ElevenLabsAudioGeneration';
import MiniMaxAudioGeneration from '@/models/MiniMaxAudioGeneration';
import { withProjectLock } from '@/lib/server/workbench/projectLock';
import { assertStoredFilesUnreferenced } from '@/lib/server/storage/references';
import { deleteStoredFilesByOwner } from '@/lib/server/storage/service';
import { getClientIP, rateLimit } from '@/lib/rateLimit';
import { parseJsonRequest, requireUserRecord, unauthorizedResponse } from '@/lib/server/api/routeHelpers';
import { assertMediaWriteLeaseActive, beginMediaWriteLease, endMediaWriteLease } from '@/lib/media/server/userOperationLeases';
import { serializeAudioGeneration, serializeMiniMaxAudioGeneration } from '@/lib/media/server/audioRecords';
import { elevenlabsErrorStatus, elevenlabsPublicMessage } from '@/lib/media/server/elevenlabsAudio';
import { minimaxErrorStatus, minimaxPublicMessage } from '@/lib/media/server/minimaxAudio';
import { generateElevenLabsSpeech, previewElevenLabsSpeech } from '@/lib/media/server/operations/elevenlabsSpeech';
import { generateMiniMaxSpeech, previewMiniMaxSpeech } from '@/lib/media/server/operations/minimaxSpeech';

function createAudioRoutes({ provider, label, Generation, serializeGeneration, generate, preview, publicMessage, errorStatus }) {
  async function authenticate(request) {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    return auth?.payload ? String(auth.payload.userId) : null;
  }
  const failure = (error, message) => Response.json({ success: false, message: publicMessage(error, message) }, { status: errorStatus(error) });

  async function listGenerations(request) {
    try {
      const userId = await authenticate(request);
      if (!userId) return unauthorizedResponse("未登录");
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (cursor && !mongoose.isValidObjectId(cursor)) return Response.json({ message: '语音记录游标无效' }, { status: 400 });
      const records = await Generation.find({ userId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(25).lean();
      const page = records.slice(0, 24);
      return Response.json({ success: true, generations: page.map(serializeGeneration), nextCursor: records.length > 24 ? String(page.at(-1)._id) : null });
    } catch (error) { return failure(error, "读取语音记录失败"); }
  }

  async function createGeneration(request) {
    try {
      const userId = await authenticate(request);
      if (!userId) return unauthorizedResponse("未登录");
      if (!rateLimit(`${provider}-generation:${userId}:${getClientIP(request)}`, { limit: 10, windowMs: 60000 }).success) {
        return Response.json({ success: false, message: "语音生成请求较多，请稍后再试" }, { status: 429 });
      }
      const parsed = await parseJsonRequest(request, "请求内容格式错误", 128 * 1024);
      if (!parsed.ok) return parsed.response;
      const result = await generate({ userId, body: parsed.body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
      return Response.json(result.data, { status: result.status });
    } catch (error) { return failure(error, "语音生成失败"); }
  }

  async function deleteGeneration(request, context) {
    let lease;
    try {
      const userId = await authenticate(request);
      if (!userId) return unauthorizedResponse("未登录");
      lease = await beginMediaWriteLease(userId);
      return await withProjectLock(userId, 'task-creation', async () => {
        const { id } = await context.params;
        const record = await Generation.findOne({ userId, generationId: id }).lean();
        if (!record) return Response.json({ success: false, message: "语音记录不存在" }, { status: 404 });
        const files = await StoredFile.find({ userId, ownerType: 'audio-generation', ownerId: record.generationId }).lean();
        await assertStoredFilesUnreferenced(userId, files);
        await assertMediaWriteLeaseActive(lease);
        await deleteStoredFilesByOwner({ userId, ownerType: "audio-generation", ownerId: record.generationId });
        await Generation.deleteOne({ userId, _id: record._id });
        return Response.json({ success: true, deleted: true });
      });
    } catch (error) { return failure(error, "删除语音记录失败"); }
    finally {
      if (lease) await endMediaWriteLease(lease).catch((error) => { console.error(`[${label}] release media lease:`, error); });
    }
  }

  async function previewVoice(request) {
    try {
      const userId = await authenticate(request);
      if (!userId) return unauthorizedResponse("未登录");
      if (!rateLimit(`${provider}-preview:${userId}:${getClientIP(request)}`, { limit: 20, windowMs: 60000 }).success) {
        return Response.json({ success: false, message: "试听请求较多，请稍后再试" }, { status: 429 });
      }
      const parsed = await parseJsonRequest(request, "请求内容格式错误", 4096);
      if (!parsed.ok) return parsed.response;
      const result = await preview({ userId, body: parsed.body, clientOperationId: request.headers.get("x-credit-operation-id"), signal: request.signal });
      if (!result.audioBuffer) return Response.json(result.data, { status: result.status });
      return new Response(result.audioBuffer, { headers: { "Content-Type": result.mimeType, "Cache-Control": "private, no-store" } });
    } catch (error) { return failure(error, "音色试听失败"); }
  }

  return { listGenerations, createGeneration, deleteGeneration, previewVoice };
}

export const elevenlabsAudioRoutes = createAudioRoutes({
  provider: 'elevenlabs', label: 'ElevenLabs', Generation: ElevenLabsAudioGeneration, serializeGeneration: serializeAudioGeneration,
  generate: generateElevenLabsSpeech, preview: previewElevenLabsSpeech, publicMessage: elevenlabsPublicMessage, errorStatus: elevenlabsErrorStatus,
});

export const minimaxAudioRoutes = createAudioRoutes({
  provider: 'minimax', label: 'MiniMax', Generation: MiniMaxAudioGeneration, serializeGeneration: serializeMiniMaxAudioGeneration,
  generate: generateMiniMaxSpeech, preview: previewMiniMaxSpeech, publicMessage: minimaxPublicMessage, errorStatus: minimaxErrorStatus,
});
