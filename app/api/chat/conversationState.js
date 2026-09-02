import Conversation from "@/models/Conversation";
import { getModelProvider } from "@/lib/shared/models";
import { isValidConversationId } from "@/lib/server/conversations/service";
import { deleteStoredFilesByIds } from "@/lib/server/storage/service";

export const CONVERSATION_WRITE_CONFLICT_ERROR = "当前对话已被其他请求更新，请重试";

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function loadConversationForRoute({ conversationId, userId, expectedProvider }) {
  if (!conversationId) return null;
  if (!isValidConversationId(conversationId)) {
    throw createHttpError("Invalid id", 400);
  }

  const conversation = await Conversation.findOne({ _id: conversationId, userId }).lean();
  if (!conversation) {
    throw createHttpError("Not found", 404);
  }

  if (expectedProvider && getModelProvider(conversation.model) !== expectedProvider) {
    throw createHttpError("当前对话与所选模型不匹配", 400);
  }

  return conversation;
}

export function buildConversationWriteCondition(conversationId, userId, writePermitTime) {
  if (!writePermitTime) {
    return { _id: conversationId, userId };
  }
  return {
    _id: conversationId,
    userId,
    updatedAt: new Date(writePermitTime),
  };
}

export function nextConversationWriteTime(writePermitTime) {
  const permit = Number.isFinite(writePermitTime) ? writePermitTime : 0;
  return new Date(Math.max(Date.now(), permit + 1));
}

export async function rollbackConversationTurn({
  conversationId,
  userId,
  createdConversationForRequest = false,
  isRegenerateMode = false,
  previousMessages = [],
  userMessageId,
  modelMessageId,
  writePermitTime,
  newlyBoundFileIds = [],
}) {
  if (!conversationId || !userId) return false;

  const writeCondition = buildConversationWriteCondition(conversationId, userId, writePermitTime);
  const rollbackTime = nextConversationWriteTime(writePermitTime);

  if (createdConversationForRequest) {
    const result = await Conversation.deleteOne(writeCondition);
    if (result?.deletedCount > 0) {
      await deleteStoredFilesByIds({
        userId,
        fileIds: newlyBoundFileIds,
        ownerType: "conversation",
        ownerId: conversationId,
      });
    }
    return result?.deletedCount > 0;
  }

  if (isRegenerateMode) {
    const restored = await Conversation.findOneAndUpdate(writeCondition, {
      $set: {
        messages: Array.isArray(previousMessages) ? previousMessages : [],
        updatedAt: rollbackTime,
      },
    });
    if (restored) {
      await deleteStoredFilesByIds({
        userId,
        fileIds: newlyBoundFileIds,
        ownerType: "conversation",
        ownerId: conversationId,
      });
    }
    return Boolean(restored);
  }

  const messageIds = [userMessageId, modelMessageId]
    .filter((value) => typeof value === "string" && value);
  if (messageIds.length === 0) return false;

  const updated = await Conversation.findOneAndUpdate(writeCondition, {
    $pull: {
      messages: { id: { $in: messageIds } },
    },
    $set: {
      updatedAt: rollbackTime,
    },
  });
  if (updated) {
    await deleteStoredFilesByIds({
      userId,
      fileIds: newlyBoundFileIds,
      ownerType: "conversation",
      ownerId: conversationId,
    });
  }
  return Boolean(updated);
}
