import Conversation from "@/models/Conversation";
import mongoose from "mongoose";
import {
  sanitizeConversationBody,
  sanitizeThinkingTimeline,
} from "@/lib/server/conversations/sanitize";
import {
  bindStoredFiles,
  collectStoredFileIds,
  deleteStoredFilesByIds,
  deleteStoredFilesByOwner,
} from "@/lib/server/storage/service";

export function isValidConversationId(id) {
  return mongoose.isValidObjectId(id);
}

export async function getConversationForUser(id, userId) {
  return Conversation.findOne({ _id: id, userId }).lean();
}

export async function deleteConversationForUser(id, userId) {
  await deleteStoredFilesByOwner({ userId, ownerType: "conversation", ownerId: id });
  await Conversation.deleteOne({ _id: id, userId });
}

export async function updateConversationForUser(id, userId, body) {
  const currentConversation = await Conversation.findOne({ _id: id, userId }).select("model messages");
  if (!currentConversation) {
    return null;
  }

  const update = sanitizeConversationBody(body);
  const previousFileIds = collectStoredFileIds(currentConversation.messages);
  if (Array.isArray(update.messages)) {
    await bindStoredFiles({
      userId,
      fileIds: collectStoredFileIds(update.messages),
      ownerType: "conversation",
      ownerId: id,
    });
  }

  if (Object.keys(update).length === 0) {
    return Conversation.findOne({ _id: id, userId });
  }
  const updatedConversation = await Conversation.findOneAndUpdate(
    { _id: id, userId },
    { $set: update },
    { new: true }
  );
  if (updatedConversation && Array.isArray(update.messages)) {
    const nextIds = new Set(collectStoredFileIds(update.messages));
    await deleteStoredFilesByIds({
      userId,
      fileIds: previousFileIds.filter((fileId) => !nextIds.has(fileId)),
      ownerType: "conversation",
      ownerId: id,
    });
  }
  return updatedConversation;
}

export async function updateConversationMessageTimeline(id, userId, { messageId, thinkingTimeline }) {
  const normalizedMessageId = typeof messageId === "string" ? messageId.trim() : "";
  if (!normalizedMessageId || normalizedMessageId.length > 128) {
    throw new Error("messageId invalid");
  }
  const timeline = sanitizeThinkingTimeline(thinkingTimeline);
  const updatedConversation = await Conversation.findOneAndUpdate(
    {
      _id: id,
      userId,
      messages: { $elemMatch: { id: normalizedMessageId, role: "model" } },
    },
    {
      $set: {
        "messages.$[message].thinkingTimeline": timeline,
      },
    },
    {
      new: true,
      arrayFilters: [{ "message.id": normalizedMessageId, "message.role": "model" }],
    },
  ).select("_id");
  return Boolean(updatedConversation);
}
