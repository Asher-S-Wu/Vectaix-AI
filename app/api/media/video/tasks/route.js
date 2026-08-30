import { modelAccessResponse } from "@/lib/server/guest/access";
import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  parseJsonRequest,
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  VIDEO_MODEL,
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_EDIT_RESOLUTION_OPTIONS,
  VIDEO_IMAGE_ACCEPTED_MIME_TYPES,
  VIDEO_IMAGE_MAX_BYTES,
  VIDEO_MODEL_IDS,
  VIDEO_MODELS,
  VIDEO_MODES,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
  VIDEO_SEED_MAX,
  VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES,
  VIDEO_SOURCE_VIDEO_MAX_BYTES,
  getVideoPromptWeight,
} from "@/lib/media/shared/models";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import StoredFile from "@/models/StoredFile";
import { createHappyHorseVideoTask } from "@/lib/media/server/happyhorse/videos";
import {
  applyHappyHorseTaskResult,
  failCreatedVideoTask,
  serializeVideoTask,
} from "@/lib/media/server/happyhorse/taskRecords";
import {
  buildVideoSourceUrl,
  createVideoSourceAccess,
} from "@/lib/media/server/happyhorse/sourceAccess";
import { normalizeFileId } from "@/lib/server/storage/service";
import {
  assertMediaWriteLeaseActive,
  beginMediaWriteLease,
  endMediaWriteLease,
} from "@/lib/media/server/userOperationLeases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_TASK_RATE_LIMIT = Object.freeze({ limit: 6, windowMs: 60 * 1000 });
const TASK_REQUEST_MAX_BYTES = 64 * 1024;
const TASK_SUBMISSION_TIMEOUT_MS = 2 * 60 * 1000;
const ALLOWED_MODES = new Set(VIDEO_MODES);
const ALLOWED_RATIOS = new Set(VIDEO_ASPECT_RATIO_OPTIONS.map((item) => item.id));
const ALLOWED_DURATIONS = new Set(VIDEO_DURATION_OPTIONS.map((item) => item.id));
const ALLOWED_RESOLUTIONS = new Set(VIDEO_RESOLUTION_OPTIONS.map((item) => item.id));
const ALLOWED_EDIT_RESOLUTIONS = new Set(VIDEO_EDIT_RESOLUTION_OPTIONS.map((item) => item.id));
const ALLOWED_IMAGE_MIME_TYPES = new Set(VIDEO_IMAGE_ACCEPTED_MIME_TYPES);
const ALLOWED_VIDEO_MIME_TYPES = new Set(VIDEO_SOURCE_VIDEO_ACCEPTED_MIME_TYPES);
const ALLOWED_AUDIO_SETTINGS = new Set(["auto", "origin"]);
const TASK_INPUT_FIELDS = new Set([
  "mode",
  "prompt",
  "imageFileIds",
  "videoFileId",
  "resolution",
  "ratio",
  "duration",
  "audioSetting",
  "seed",
  "watermark",
]);
const REQUIRED_TASK_INPUT_FIELDS = Object.freeze([
  "mode",
  "prompt",
  "imageFileIds",
  "videoFileId",
  "resolution",
  "watermark",
]);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readFileIds(value) {
  if (!Array.isArray(value)) throw new Error("图片素材列表格式错误");
  const ids = value.map((item) => normalizeFileId(item));
  if (ids.some((item) => !item) || new Set(ids).size !== ids.length) {
    throw new Error("图片素材编号无效或重复");
  }
  return ids;
}

function parseTaskInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("请求内容格式错误");
  }
  if (Object.keys(body).some((key) => !TASK_INPUT_FIELDS.has(key))) {
    throw new Error("请求包含当前视频模式不支持的字段");
  }
  if (REQUIRED_TASK_INPUT_FIELDS.some((key) => !Object.hasOwn(body, key))) {
    throw new Error("视频任务请求缺少必要字段");
  }
  if (
    typeof body.mode !== "string"
    || typeof body.prompt !== "string"
    || typeof body.videoFileId !== "string"
    || typeof body.resolution !== "string"
  ) {
    throw new Error("视频任务请求字段格式错误");
  }
  const mode = readString(body.mode);
  const prompt = readString(body.prompt);
  const imageFileIds = readFileIds(body.imageFileIds);
  const videoFileId = body.videoFileId ? normalizeFileId(body.videoFileId) : "";
  const resolution = readString(body.resolution);
  const watermark = body.watermark;
  const hasSeed = Object.hasOwn(body, "seed");
  const seed = hasSeed ? body.seed : null;

  if (!ALLOWED_MODES.has(mode)) throw new Error("不支持的视频生成模式");
  if (mode !== "first-frame" && !prompt) throw new Error("请输入视频描述");
  if (getVideoPromptWeight(prompt) > VIDEO_PROMPT_MAX_LENGTH) {
    throw new Error("视频描述最多支持 2500 个中文字符或 5000 个其他字符");
  }
  if (typeof watermark !== "boolean") throw new Error("水印参数格式错误");
  if (hasSeed && (!Number.isInteger(seed) || seed < 0 || seed > VIDEO_SEED_MAX)) {
    throw new Error(`随机种子必须是 0 至 ${VIDEO_SEED_MAX} 的整数`);
  }
  if (!videoFileId && body.videoFileId) throw new Error("视频素材编号无效");

  if (mode === "text") {
    if (imageFileIds.length || videoFileId) throw new Error("文生视频模式不能附带素材文件");
    if (!Object.hasOwn(body, "ratio") || !Object.hasOwn(body, "duration")) {
      throw new Error("文生视频缺少画面比例或时长");
    }
  } else if (mode === "first-frame") {
    if (imageFileIds.length !== 1 || videoFileId) throw new Error("首帧生视频必须上传一张图片");
    if (body.ratio !== undefined) throw new Error("首帧生视频不支持设置画面比例");
    if (!Object.hasOwn(body, "duration")) throw new Error("首帧生视频缺少时长");
  } else if (mode === "reference") {
    if (imageFileIds.length < 1 || imageFileIds.length > 9 || videoFileId) {
      throw new Error("多图参考模式必须上传 1 至 9 张图片");
    }
    if (!Object.hasOwn(body, "ratio") || !Object.hasOwn(body, "duration")) {
      throw new Error("多图参考模式缺少画面比例或时长");
    }
  } else if (mode === "edit") {
    if (!videoFileId) throw new Error("视频编辑必须上传一个视频");
    if (imageFileIds.length > 5) throw new Error("视频编辑最多支持 5 张参考图片");
    if (body.ratio !== undefined || body.duration !== undefined) {
      throw new Error("视频编辑不支持设置画面比例或时长");
    }
    if (!Object.hasOwn(body, "audioSetting")) throw new Error("视频编辑缺少声音处理方式");
  }

  const allowedResolutionSet = mode === "edit" ? ALLOWED_EDIT_RESOLUTIONS : ALLOWED_RESOLUTIONS;
  if (!allowedResolutionSet.has(resolution)) throw new Error("不支持的分辨率");

  const params = { resolution, watermark };
  if (hasSeed) params.seed = seed;
  if (mode !== "edit") {
    const duration = body.duration;
    if (!ALLOWED_DURATIONS.has(duration)) throw new Error("视频时长必须是 3 至 15 秒的整数");
    params.duration = duration;
  }
  if (mode === "text" || mode === "reference") {
    const ratio = readString(body.ratio);
    if (!ALLOWED_RATIOS.has(ratio)) throw new Error("不支持的画面比例");
    params.ratio = ratio;
  }
  if (mode === "edit") {
    const audioSetting = readString(body.audioSetting);
    if (!ALLOWED_AUDIO_SETTINGS.has(audioSetting)) throw new Error("不支持的声音处理方式");
    params.audioSetting = audioSetting;
  } else if (body.audioSetting !== undefined) {
    throw new Error("当前模式不支持设置声音处理方式");
  }

  return { mode, prompt, imageFileIds, videoFileId, params };
}

async function loadAndValidateSources(userId, input) {
  const fileIds = [...input.imageFileIds, ...(input.videoFileId ? [input.videoFileId] : [])];
  if (fileIds.length === 0) return { fileIds, images: [], video: null };
  const files = await StoredFile.find({ userId, fileId: { $in: fileIds } });
  if (files.length !== fileIds.length) throw requestError("素材不存在或无权访问");
  const fileMap = new Map(files.map((file) => [file.fileId, file]));
  const orderedImages = input.imageFileIds.map((fileId) => fileMap.get(fileId));
  const video = input.videoFileId ? fileMap.get(input.videoFileId) : null;

  for (const image of orderedImages) {
    if (
      !image
      || image.ownerType !== "temporary"
      || image.kind !== "media-image"
      || image.category !== "image"
      || !ALLOWED_IMAGE_MIME_TYPES.has(image.mimeType)
      || image.size <= 0
      || image.size > VIDEO_IMAGE_MAX_BYTES
    ) {
      throw requestError("图片素材格式不正确、已被使用或超过 20MB");
    }
  }
  if (video && (
    video.ownerType !== "temporary"
    || video.kind !== "media-video"
    || video.category !== "video"
    || !ALLOWED_VIDEO_MIME_TYPES.has(video.mimeType)
    || video.size <= 0
    || video.size > VIDEO_SOURCE_VIDEO_MAX_BYTES
  )) {
    throw requestError("视频素材格式不正确、已被使用或超过 100MB");
  }
  return { fileIds, images: orderedImages, video };
}

async function bindVideoTaskSources({ userId, fileIds, taskId }) {
  if (!fileIds.length) return;
  const ownerId = String(taskId);
  const result = await StoredFile.updateMany(
    {
      userId,
      fileId: { $in: fileIds },
      ownerType: "temporary",
      ownerId: null,
    },
    { $set: { ownerType: "video-task", ownerId } },
  );
  if (result.modifiedCount === fileIds.length) return;
  await StoredFile.updateMany(
    {
      userId,
      fileId: { $in: fileIds },
      ownerType: "video-task",
      ownerId,
    },
    { $set: { ownerType: "temporary", ownerId: null } },
  );
  const error = new Error("素材已被其他视频任务使用");
  error.status = 409;
  throw error;
}

export async function GET(request) {
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const tasks = await VideoGenerationTask.find({
      userId: user.userId,
      model: { $in: VIDEO_MODEL_IDS },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return Response.json({ success: true, tasks: tasks.map(serializeVideoTask).filter(Boolean) });
  } catch (error) {
    console.error("[Media Video] list tasks:", error);
    return jsonMessage(publicMessage(error, "读取视频任务失败"), 500);
  }
}

export async function POST(request) {
  let mediaWriteLease = null;
  let task = null;
  let sourcesBound = false;
  let failureHandled = false;
  try {
    const auth = await requireUserRecord({ request, connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");
    const accessError = modelAccessResponse(user, VIDEO_MODEL);
    if (accessError) return accessError;

    const limited = rateLimit(
      `media-video:${user.userId}:${getClientIP(request)}`,
      VIDEO_TASK_RATE_LIMIT,
    );
    if (!limited.success) return jsonMessage("请求过于频繁，请稍后再试", 429);

    const parsed = await parseJsonRequest(request, "请求内容必须是 JSON", TASK_REQUEST_MAX_BYTES);
    if (!parsed.ok) return parsed.response;
    let input;
    try {
      input = parseTaskInput(parsed.body);
    } catch (error) {
      return jsonMessage(publicMessage(error, "视频任务参数不正确"), 400);
    }
    const sources = await loadAndValidateSources(user.userId, input);
    mediaWriteLease = await beginMediaWriteLease(user.userId);
    const sourceAccess = sources.fileIds.length
      ? createVideoSourceAccess()
      : { token: "", tokenHash: null, expiresAt: null };

    await assertMediaWriteLeaseActive(mediaWriteLease);

    task = await VideoGenerationTask.create({
      userId: user.userId,
      status: "queued",
      model: VIDEO_MODELS[input.mode],
      mode: input.mode,
      prompt: input.prompt,
      inputFileIds: sources.fileIds,
      params: {
        ...input.params,
        imageCount: input.imageFileIds.length,
        hasSourceVideo: Boolean(input.videoFileId),
      },
      sourceAccessTokenHash: sourceAccess.tokenHash,
      sourceAccessTokenExpiresAt: sourceAccess.expiresAt,
    });

    if (sources.fileIds.length) {
      await assertMediaWriteLeaseActive(mediaWriteLease);
      await bindVideoTaskSources({
        userId: user.userId,
        fileIds: sources.fileIds,
        taskId: task._id,
      });
    }
    sourcesBound = true;

    const sourceUrls = {
      images: input.imageFileIds.map((fileId) => buildVideoSourceUrl({
        taskId: task._id,
        fileId,
        token: sourceAccess.token,
      })),
      video: input.videoFileId
        ? buildVideoSourceUrl({ taskId: task._id, fileId: input.videoFileId, token: sourceAccess.token })
        : "",
    };

    let upstreamTask;
    try {
      upstreamTask = await createHappyHorseVideoTask({
        mode: input.mode,
        prompt: input.prompt,
        params: input.params,
        sourceUrls,
        signal: AbortSignal.timeout(TASK_SUBMISSION_TIMEOUT_MS),
      });
      const upstreamTaskId = readString(upstreamTask?.output?.task_id);
      if (!upstreamTaskId) throw new Error("HappyHorse 未返回任务编号");
      await assertMediaWriteLeaseActive(mediaWriteLease);
      const localTaskId = task._id;
      const updatedTask = await VideoGenerationTask.findOneAndUpdate(
        { _id: localTaskId, status: "queued", upstreamTaskId: null },
        { $set: { upstreamTaskId, upstreamResponse: upstreamTask, upstreamUpdatedAt: new Date() } },
        { new: true },
      );
      if (!updatedTask) {
        task = await VideoGenerationTask.findById(localTaskId);
        const stateError = new Error("本地视频任务状态已失效，未保存上游任务编号");
        stateError.code = "VIDEO_TASK_STATE_CHANGED";
        throw stateError;
      }
      task = updatedTask;
      task = await applyHappyHorseTaskResult(task, upstreamTask, {
        mediaWriteLease,
      });
    } catch (error) {
      if (sourcesBound) {
        failureHandled = true;
        task = await failCreatedVideoTask(task, error, { mediaWriteLease });
      }
      throw error;
    }

    return Response.json({ success: true, task: serializeVideoTask(task) }, { status: 201 });
  } catch (error) {
    if (task && !failureHandled) {
      if (sourcesBound) {
        failureHandled = true;
        await failCreatedVideoTask(task, error, { mediaWriteLease }).catch((cleanupError) => {
          console.error("[Media Video] record failed task:", cleanupError);
        });
      } else {
        await VideoGenerationTask.deleteOne({ _id: task._id }).catch(() => {});
      }
    }
    console.error("[Media Video] create task:", error);
    const status = Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
    return jsonMessage(publicMessage(error, "视频任务创建失败"), status);
  } finally {
    if (mediaWriteLease) {
      await endMediaWriteLease(mediaWriteLease).catch((error) => {
        console.error("[Media Video] release task write lease:", error);
      });
    }
  }
}
