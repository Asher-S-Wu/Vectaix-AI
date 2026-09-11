import { withProjectLock } from "./projectLock";
import { createScopedFileQuery } from "./documents";
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import WorkbenchTask from '@/models/WorkbenchTask';
import CreditTransaction from '@/models/CreditTransaction';
import StoredFile from '@/models/StoredFile';
import VideoGenerationTask from '@/models/VideoGenerationTask';
import VideoEnhancementTask from '@/models/VideoEnhancementTask';
import { generateImage } from '@/lib/media/server/operations/image';
import { editImage } from '@/lib/media/server/operations/imageEdit';
import { generateQwenSpeech } from '@/lib/media/server/operations/qwenSpeech';
import { generateMinimaxSpeech } from '@/lib/media/server/operations/minimaxSpeech';
import { generateDoubaoSpeech } from '@/lib/media/server/operations/doubaoSpeech';
import { generateVideo } from '@/lib/media/server/operations/video';
import { enhanceVideo } from '@/lib/media/server/operations/enhancement';
import { shouldSyncVideoTask, syncVideoTaskRecord } from '@/lib/media/server/happyhorse/taskRecords';
import { syncMediaKitVideoEnhancementTask } from '@/lib/media/server/mediaKit/reconciler';
import { beginMediaWriteLease, endMediaWriteLease } from '@/lib/media/server/userOperationLeases';
import { findOwnedStoredFile, readStoredFileBuffer, createStoredFileReadStream, createStoredFileFromWebStream, buildStoredFileUrl } from '@/lib/server/storage/service';
import { resolveQwenImageConfig, resolveQwenAudioConfig, resolveMinimaxAudioConfig, resolveDoubaoAudioConfig, resolveHappyHorseVideoConfig, resolveAiMediaKitConfig } from '@/lib/modelRoutes';
import { appendTaskEvent } from './events';
import { defineTaskTool, textParameter } from './tools';

const TERMINAL = new Set(['completed', 'failed', 'canceled']);
const SPEECH = {
  qwen: { execute: generateQwenSpeech, feature: 'qwen_tts_generate', resolve: resolveQwenAudioConfig, fields: ['voiceId', 'format', 'sampleRate', 'instruction', 'rate', 'pitch', 'volume', 'languageHint'] },
  minimax: { execute: generateMinimaxSpeech, feature: 'media_audio_minimax_generation', resolve: resolveMinimaxAudioConfig, fields: ['voiceId', 'format', 'sampleRate', 'model', 'emotion', 'speed', 'volume', 'pitch', 'languageBoost'] },
  doubao: { execute: generateDoubaoSpeech, feature: 'media_audio_seed_generation', resolve: resolveDoubaoAudioConfig, fields: ['voiceId', 'format', 'sampleRate', 'instruction', 'speechRate', 'loudnessRate', 'pitchRate'] },
};

function operationUuid(taskId, callId) {
  if (typeof callId !== 'string' || !callId) throw new Error('媒体工具缺少调用编号');
  const hex = crypto.createHash('sha256').update(`${taskId}:${callId}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

function configurationState(settings, fields, resolver) {
  if (!settings || fields.some((field) => !Object.hasOwn(settings, field) || settings[field] === null || settings[field] === undefined)) return { available: false, reason: '用户尚未配置完整参数' };
  try { resolver(); } catch { return { available: false, reason: '服务器尚未配置此媒体服务' }; }
  return { available: true };
}

function parseFileIds(value) {
  const ids = JSON.parse(value);
  if (!Array.isArray(ids) || ids.length > 9 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('素材编号列表无效');
  return ids;
}

async function copyFile({ userId, file, ownerType, ownerId, name, signal, assertActive }) {
  await assertActive();
  const mediaWriteLease = await beginMediaWriteLease(userId);
  try {
    const copied = await createStoredFileFromWebStream({
      userId,
      input: Readable.toWeb(createStoredFileReadStream(file)),
      originalName: name,
      mimeType: file.mimeType,
      extension: file.extension,
      category: file.category,
      kind: `media-${file.category}`,
      ownerType,
      ownerId,
      maxBytes: file.size,
      signal,
      mediaWriteLease,
      assertWriteCommitAllowed: assertActive,
    });
    if (file.videoDuration !== null && file.videoDuration !== undefined) {
      copied.videoDuration = file.videoDuration;
      await copied.save();
    }
    return copied;
  } finally { await endMediaWriteLease(mediaWriteLease); }
}

async function accountBilling(task, operationId) {
  return withProjectLock("billing", String(task._id), () => accountBillingLocked(task, operationId));
}

async function accountBillingLocked(task, operationId) {
  const transaction = await CreditTransaction.findOne({ userId: task.userId, operationId }).lean();
  if (!transaction) return;
  if (transaction.status === 'review_required') {
    await WorkbenchTask.updateOne({ _id: task._id }, { $set: { billingReviewRequired: true } });
  }
  const charged = transaction.actualCostCny === null ? 0 : Number(transaction.actualCostCny);
  if (!Number.isFinite(charged)) throw new Error('媒体计费记录无效');
  const previous = { $sum: { $map: { input: '$mediaTasks', as: 'media', in: { $cond: [{ $eq: ['$$media.operationId', operationId] }, '$$media.accountedCostCny', 0] } } } };
  const updated = await WorkbenchTask.updateOne({
    _id: task._id,
    mediaTasks: { $elemMatch: { operationId, $or: [{ accountedCostCny: { $ne: charged } }, { billingStatus: { $ne: transaction.status } }] } },
  }, [{ $set: {
    costCny: { $sum: ['$costCny', { $subtract: [charged, previous] }] },
    mediaTasks: { $map: { input: '$mediaTasks', as: 'media', in: { $cond: [
      { $eq: ['$$media.operationId', operationId] },
      { $mergeObjects: ['$$media', { accountedCostCny: charged, billingStatus: transaction.status }] },
      '$$media',
    ] } } },
  } }]);
  if (updated.modifiedCount) await appendTaskEvent(task, 'billing', '媒体计费状态已更新', { operationId, costCny: charged, status: transaction.status });
}

async function saveMediaArtifact({ task, fileId, name, operationId, signal, assertActive }) {
  const userId = String(task.userId), taskId = String(task._id);
  return withProjectLock(userId, 'task-creation', async () => {
    await assertActive();
    const file = await findOwnedStoredFile({ userId, fileId });
    if (!file) throw new Error('媒体结果文件不存在');
    const safeName = typeof name === 'string' ? name.trim().replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) : '';
    if (!safeName) throw new Error('请提供结果名称');
    const claim = await WorkbenchTask.updateOne({ _id: task._id, userId, mediaTasks: { $elemMatch: { operationId, artifactClaimed: false } } }, { $set: { 'mediaTasks.$.artifactClaimed': true } });
    if (claim.modifiedCount !== 1) {
      const registered = await WorkbenchTask.findOne({ _id: task._id, userId }).select('mediaTasks artifacts').lean();
      const artifactId = registered?.mediaTasks.find(media => media.operationId === operationId)?.artifactFileId;
      const artifact = registered?.artifacts.find(item => item.fileId === artifactId);
      if (artifact) return artifact;
      throw new Error('该媒体结果的登记未完成，请检查任务记录');
    }
    const copied = await copyFile({ userId, file, ownerType: 'task', ownerId: taskId, name: safeName.endsWith(`.${file.extension}`) ? safeName : `${safeName}.${file.extension}`, signal, assertActive });
    const result = { fileId: copied.fileId, name: copied.originalName, mimeType: copied.mimeType, size: copied.size, url: buildStoredFileUrl(copied.fileId), extension: copied.extension, category: copied.category };
    await WorkbenchTask.updateOne({ _id: task._id, 'mediaTasks.operationId': operationId }, { $push: { artifacts: result }, $set: { 'mediaTasks.$.artifactFileId': copied.fileId } });
    await appendTaskEvent(task, 'artifact', `已生成 ${result.name}`, result);
    return result;
  });
}

export async function syncTaskMediaBilling(task) {
  const current = await WorkbenchTask.findOne({ _id: task._id, userId: task.userId }).select('mediaTasks status');
  if (!current) return;
  for (const media of current.mediaTasks) {
    await accountBilling(task, media.operationId);
    if (!['video', 'enhancement'].includes(media.kind)) continue;
    const Model = media.kind === 'video' ? VideoGenerationTask : VideoEnhancementTask;
    let record = await Model.findOne({ userId: task.userId, 'billing.operationId': media.operationId }).select('+upstreamTaskId +billingPricingSnapshot');
    if (record && !['queued','running','waiting_media','waiting_approval'].includes(current.status) && !TERMINAL.has(record.status)) {
      if (media.kind === 'video' && shouldSyncVideoTask(record)) {
        const lease = await beginMediaWriteLease(String(task.userId));
        try { await syncVideoTaskRecord(record, { signal: AbortSignal.timeout(30000), mediaWriteLease: lease }); }
        finally { await endMediaWriteLease(lease); }
      } else if (media.kind === 'enhancement') await syncMediaKitVideoEnhancementTask(record);
      record = await Model.findOne({ _id: record._id, userId: task.userId });
    }
    if (!record) continue;
    await WorkbenchTask.updateOne({ _id: task._id, 'mediaTasks.operationId': media.operationId }, { $set: {
      'mediaTasks.$.recordId': String(record._id),
      'mediaTasks.$.status': record.status,
      'mediaTasks.$.sourceFileId': record.videoFileId,
    } });
    await accountBilling(task, media.operationId);
    if (!['queued','running','waiting_media','waiting_approval'].includes(current.status) && record.status === 'completed' && record.videoFileId && !media.artifactClaimed) {
      await saveMediaArtifact({ task, fileId: record.videoFileId, name: media.name, operationId: media.operationId, signal: AbortSignal.timeout(30000), assertActive: async () => {
        if (!await WorkbenchTask.exists({ _id: task._id, userId: task.userId })) throw new Error('任务已被删除');
      } });
    }
  }
}

export async function registerMediaTools({ registry, task, signal, assertActive }) {
  const userId = String(task.userId), taskId = String(task._id), projectId = task.projectId ? String(task.projectId) : null, conversationId = String(task.conversationId);
  const settings = task.mediaSettings;
  const audio = settings.audio;
  const speech = audio && SPEECH[audio.provider];
  const videoFields = settings.video?.mode === 'edit' ? ['mode', 'resolution', 'watermark', 'audioSetting'] : ['mode', 'resolution', 'watermark', 'duration', ...(settings.video?.mode === 'first-frame' ? [] : ['ratio'])];
  const capabilities = {
    image: configurationState(settings.image, ['size'], resolveQwenImageConfig),
    audio: speech ? configurationState(audio, speech.fields, speech.resolve) : { available: false, reason: '用户尚未选择配音服务和声音' },
    video: configurationState(settings.video, videoFields, resolveHappyHorseVideoConfig),
    enhancement: configurationState(settings.enhancement, ['resolution', 'bitrate'], resolveAiMediaKitConfig),
  };
  registry.add(defineTaskTool('media_capabilities', '查看当前任务已经配置的图片、配音、视频和画质增强能力。缺失配置时不得猜测参数或声称已经制作。', {}, async () => capabilities));

  async function projectMediaQuery() {
    return createScopedFileQuery({ userId, projectId, conversationId });
  }
  registry.add(defineTaskTool('list_media', '列出当前对话及所属项目任务已经生成的图片、音频与视频素材，使用返回的文件编号继续编辑。', {}, async () => {
    const files = await StoredFile.find({ ...(await projectMediaQuery()), category: { $in: ['image', 'audio', 'video'] } }).select('fileId originalName category mimeType extension videoDuration').sort({ createdAt: -1 }).lean();
    return { files: files.map((file) => ({ fileId: file.fileId, name: file.originalName, category: file.category, mimeType: file.mimeType, extension: file.extension, videoDuration: file.videoDuration })) };
  }));
  async function ownedFile(fileId, category) {
    const file = await StoredFile.findOne({ ...(await projectMediaQuery()), fileId, category });
    if (!file) throw new Error('当前对话无法使用该素材或类型不符');
    return file;
  }

  async function artifact(fileId, name, operationId) {
    return saveMediaArtifact({ task, fileId, name, operationId, signal, assertActive });
  }

  async function waitForMedia(kind, operationId) {
    const Model = kind === 'video' ? VideoGenerationTask : VideoEnhancementTask;
    await WorkbenchTask.updateOne({ _id: task._id, status: 'running', stopRequested: false }, { $set: { status: 'waiting_media' } });
    await appendTaskEvent(task, 'media_wait', '媒体已提交，正在等待供应商完成', { operationId, kind });
    while (true) {
      await assertActive();
      let record = await Model.findOne({ userId, 'billing.operationId': operationId }).select('+upstreamTaskId +billingPricingSnapshot');
      if (!record) throw new Error('媒体任务记录不存在');
      if (!TERMINAL.has(record.status)) {
        if (kind === 'video' && shouldSyncVideoTask(record)) {
          const mediaWriteLease = await beginMediaWriteLease(userId);
          try { await syncVideoTaskRecord(record, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), mediaWriteLease }); }
          finally { await endMediaWriteLease(mediaWriteLease); }
        } else if (kind === 'enhancement') await syncMediaKitVideoEnhancementTask(record);
        record = await Model.findOne({ _id: record._id, userId });
      }
      if (!record) throw new Error('媒体任务已被删除');
      await WorkbenchTask.updateOne({ _id: task._id, 'mediaTasks.operationId': operationId }, { $set: { 'mediaTasks.$.recordId': String(record._id), 'mediaTasks.$.status': record.status } });
      await accountBilling(task, operationId);
      if (TERMINAL.has(record.status)) {
        await WorkbenchTask.updateOne({ _id: task._id, status: 'waiting_media', stopRequested: false }, { $set: { status: 'running' } });
        if (record.status !== 'completed') throw new Error(`媒体制作未完成：${record.error?.message || record.status}`);
        if (!record.videoFileId) throw new Error('媒体已完成但没有结果文件');
        return record.videoFileId;
      }
      await delay(30000, undefined, { signal });
    }
  }

  async function run({ kind, feature, service, body, name, callId }) {
    await assertActive();
    const clientOperationId = operationUuid(taskId, callId);
    const operationId = `media:${feature}:${userId}:${clientOperationId}`;
    const claimed = await WorkbenchTask.updateOne({ _id: task._id, stopRequested: false, status: 'running', mediaTasks: { $not: { $elemMatch: { callId } } } }, { $push: { mediaTasks: { callId, operationId, kind, status: 'submitting', name, accountedCostCny: 0, artifactClaimed: false, createdAt: new Date() } } });
    if (claimed.modifiedCount !== 1) throw new Error('媒体操作已经提交或任务已停止，禁止重复提交');
    await appendTaskEvent(task, 'media_submit', '开始制作媒体', { operationId, kind });
    try {
      await assertActive();
      const result = await service({ userId, body, clientOperationId, signal });
      await accountBilling(task, operationId);
      if (!result.data.success && !(result.status === 202 && result.data.task)) throw new Error(result.data.message || result.data.error || '媒体制作失败');
      let fileId;
      if (kind === 'video' || kind === 'enhancement') fileId = await waitForMedia(kind, operationId);
      else if (kind === 'image') {
        const url = result.data.imageUrl;
        if (typeof url !== 'string' || !url.startsWith('/api/files/')) throw new Error('图片服务未返回本站文件');
        fileId = url.slice('/api/files/'.length);
      } else fileId = result.data.generation.audioFileId;
      const file = await artifact(fileId, name, operationId);
      await WorkbenchTask.updateOne({ _id: task._id, 'mediaTasks.operationId': operationId }, { $set: { 'mediaTasks.$.status': 'completed', 'mediaTasks.$.sourceFileId': fileId } });
      return { completed: true, artifact: file, operationId };
    } catch (error) {
      await accountBilling(task, operationId);
      let mediaStatus = 'failed';
      if (kind === 'video' || kind === 'enhancement') {
        const Model = kind === 'video' ? VideoGenerationTask : VideoEnhancementTask;
        const record = await Model.findOne({ userId, 'billing.operationId': operationId }).select('status').lean();
        if (record) mediaStatus = record.status;
      }
      await WorkbenchTask.updateOne({ _id: task._id, 'mediaTasks.operationId': operationId }, { $set: { 'mediaTasks.$.error': error.message, 'mediaTasks.$.status': mediaStatus } });
      await WorkbenchTask.updateOne({ _id: task._id, status: 'waiting_media', stopRequested: false }, { $set: { status: 'running' } });
      throw error;
    }
  }

  if (capabilities.image.available) {
    registry.add(defineTaskTool('generate_image', '按任务已经选择的尺寸生成图片并保存真实文件。', { prompt: textParameter('图片描述'), name: textParameter('图片名称') }, async ({ prompt, name }, { callId }) => run({ kind: 'image', feature: 'qwen_image_generate', service: generateImage, body: { prompt, size: settings.image.size }, name, callId })));
    registry.add(defineTaskTool('edit_image', '编辑已经存在的参考图片并保存结果，必须使用真实素材编号。', { prompt: textParameter('修改要求'), imageFileIdsJson: textParameter('1到3个图片文件编号的JSON数组'), name: textParameter('图片名称') }, async ({ prompt, imageFileIdsJson, name }, { callId }) => {
      const ids = parseFileIds(imageFileIdsJson);
      const images = [];
      for (const id of ids) { const file = await ownedFile(id, 'image'); if (file.size > 10 * 1024 * 1024) throw new Error('参考图片不能超过10MB'); images.push(new File([await readStoredFileBuffer(file)], file.originalName, { type: file.mimeType })); }
      return run({ kind: 'image', feature: 'qwen_image_edit', service: editImage, body: { prompt, size: settings.image.size, images }, name, callId });
    }));
  }
  if (capabilities.audio.available) registry.add(defineTaskTool('generate_speech', '使用用户为本任务指定的声音及音频参数朗读文本，保存真实音频。', { text: textParameter('完整朗读稿'), name: textParameter('音频名称') }, async ({ text, name }, { callId }) => {
    const { provider: _provider, ...parameters } = audio;
    return run({ kind: 'audio', feature: speech.feature, service: speech.execute, body: { ...parameters, text }, name, callId });
  }));
  if (capabilities.video.available) registry.add(defineTaskTool('generate_video', '按用户已经配置的视频模式与参数制作视频。等待真实视频完成后返回，素材仅使用已存在的文件编号。', { prompt: textParameter('视频描述'), imageFileIdsJson: textParameter('参考图片编号JSON数组，文生视频为[]'), videoFileId: textParameter('编辑模式的源视频编号，其他模式为空字符串'), name: textParameter('视频名称') }, async ({ prompt, imageFileIdsJson, videoFileId, name }, { callId }) => {
    const imageIds = parseFileIds(imageFileIdsJson), copiedIds = [];
    for (const id of imageIds) { const file = await ownedFile(id, 'image'); const copied = await copyFile({ userId, file, ownerType: 'temporary', ownerId: null, name: file.originalName, signal, assertActive }); copiedIds.push(copied.fileId); }
    let copiedVideoId = '', duration;
    if (videoFileId) { const file = await ownedFile(videoFileId, 'video'); const copied = await copyFile({ userId, file, ownerType: 'temporary', ownerId: null, name: file.originalName, signal, assertActive }); copiedVideoId = copied.fileId; duration = file.videoDuration; }
    const body = { ...settings.video, prompt, imageFileIds: copiedIds, videoFileId: copiedVideoId };
    if (settings.video.mode === 'edit') body.inputDurationSeconds = duration;
    return run({ kind: 'video', feature: 'media_video_happyhorse', service: generateVideo, body, name, callId });
  }));
  if (capabilities.enhancement.available) registry.add(defineTaskTool('enhance_video', '对公开HTTPS地址的视频进行画质增强。需真实视频地址和准确时长，等待供应商完成后保存结果。', { sourceUrl: textParameter('可公开访问的HTTPS视频地址'), durationSeconds: textParameter('源视频时长，1到60秒的数字'), name: textParameter('增强后的视频名称') }, async ({ sourceUrl, durationSeconds, name }, { callId }) => run({ kind: 'enhancement', feature: 'media_video_enhancement', service: enhanceVideo, body: { ...settings.enhancement, source: { type: 'url', url: sourceUrl }, sourceDurationSeconds: Number(durationSeconds) }, name, callId })));
}
