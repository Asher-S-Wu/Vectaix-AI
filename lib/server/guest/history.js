import mongoose from "mongoose";
import Conversation from "@/models/Conversation";
import StoredFile from "@/models/StoredFile";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import VideoEnhancementTask from "@/models/VideoEnhancementTask";
import AudioGeneration from "@/models/AudioGeneration";
import MinimaxAudioGeneration from "@/models/MinimaxAudioGeneration";
import DoubaoAudioGeneration from "@/models/DoubaoAudioGeneration";
import { GuestAccessError } from "@/lib/server/guest/links";

const PAGE_SIZE = 20;
const textTitle = (field) => ({ $substrCP: [field, 0, 100] });
const documentId = { $toString: "$_id" };
const fileUrl = (field) => ({ $concat: ["/api/files/", field] });

function historySource(model, userId, fields, filter = {}) {
  return {
    model,
    pipeline: [
      { $match: { userId, ...filter } },
      { $project: { _id: 0, ...fields } },
    ],
  };
}

function audioSource(model, userId, apiBase) {
  return historySource(model, userId, {
    id: "$generationId",
    type: { $literal: "audio" },
    title: textTitle("$text"),
    createdAt: 1,
    url: fileUrl("$audioFileId"),
    status: { $literal: "completed" },
    deleteUrl: { $concat: [apiBase, "$generationId"] },
  });
}

function getHistorySources(category, userId) {
  switch (category) {
    case "chat":
      return [historySource(Conversation, userId, {
        id: documentId,
        type: { $literal: "chat" },
        title: "$title",
        createdAt: { $toDate: "$_id" },
        conversationId: documentId,
        deleteUrl: { $concat: ["/api/conversations/", documentId] },
      })];
    case "image":
      return [historySource(StoredFile, userId, {
        id: "$fileId",
        type: { $literal: "image" },
        title: "$originalName",
        createdAt: 1,
        url: fileUrl("$fileId"),
        status: { $literal: "completed" },
        deleteUrl: { $concat: ["/api/guest/history?category=image&id=", "$fileId"] },
      }, { category: "image", kind: "media-image", ownerType: "image-result" })];
    case "video":
      return [
        historySource(VideoGenerationTask, userId, {
          id: documentId,
          type: { $literal: "video" },
          title: textTitle("$prompt"),
          createdAt: 1,
          url: fileUrl("$videoFileId"),
          status: 1,
          deleteUrl: { $concat: ["/api/media/video/tasks/", documentId] },
        }),
        historySource(VideoEnhancementTask, userId, {
          id: documentId,
          type: { $literal: "video" },
          title: "$sourceName",
          createdAt: 1,
          url: fileUrl("$videoFileId"),
          status: 1,
          deleteUrl: { $concat: ["/api/media/video-enhancement/tasks/", documentId] },
        }, { deletionRequestedAt: null }),
      ];
    case "audio":
      return [
        audioSource(AudioGeneration, userId, "/api/media/audio/generations/"),
        audioSource(MinimaxAudioGeneration, userId, "/api/media/audio/minimax/generations/"),
        audioSource(DoubaoAudioGeneration, userId, "/api/media/audio/doubao/generations/"),
      ];
    default:
      throw new GuestAccessError("GUEST_HISTORY_CATEGORY_INVALID", "请选择有效的历史记录分类");
  }
}

export async function getGuestHistory(userId, category, page) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
    throw new GuestAccessError("GUEST_HISTORY_PAGE_INVALID", "页码格式错误");
  }
  const sources = getHistorySources(category, new mongoose.Types.ObjectId(userId));
  const [first, ...rest] = sources;
  const pipeline = [
    ...first.pipeline,
    ...rest.map((source) => ({ $unionWith: { coll: source.model.collection.name, pipeline: source.pipeline } })),
    { $facet: {
      counts: [{ $count: "total" }],
      items: [{ $sort: { createdAt: -1, id: -1 } }, { $skip: (page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }],
    } },
  ];
  const [result] = await first.model.aggregate(pipeline);
  const total = result.counts.length ? result.counts[0].total : 0;
  return { items: result.items, total, page, totalPages: Math.ceil(total / PAGE_SIZE) };
}
