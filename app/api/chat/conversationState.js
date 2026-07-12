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
    updatedAt: { $lte: new Date(writePermitTime) },
  };
}

export async function rollbackConversationTurn({
  conversationId,
  userId,
  createdConversationForRequest = false,
  isRegenerateMode = false,
  previousMessages = [],
  previousUpdatedAt,
  userMessageId,
  writePermitTime,
  newlyBoundFileIds = [],
}) {
  if (!conversationId || !userId) return false;

  const writeCondition = buildConversationWriteCondition(conversationId, userId, writePermitTime);

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
        updatedAt: previousUpdatedAt ? new Date(previousUpdatedAt) : new Date(),
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

  if (!userMessageId) return false;

  const updated = await Conversation.findOneAndUpdate(writeCondition, {
    $pull: {
      messages: { id: userMessageId },
    },
    $set: {
      updatedAt: previousUpdatedAt ? new Date(previousUpdatedAt) : new Date(),
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
