import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import { generateMessageId } from "@/app/api/chat/utils";
import {
  FUSION_MAX_ROUNDS,
  FUSION_MODEL_ID,
  countCompletedFusionRounds,
} from "@/lib/shared/models";
import {
  buildFusionFinalMessage,
  buildFusionHistoryMemo,
  buildFusionResultState,
  buildFusionUserInput,
  parseNativeFusionMarkdown,
  runFusionAnswer,
} from "./fusionHelpers";
import { createFusionStreamHelpers } from "./streamHelpers";
import { enrichConversationPartsWithBlobIds } from "@/lib/server/conversations/blobReferences";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
} from "@/app/api/chat/conversationState";
import {
  CHAT_RATE_LIMIT,
  MAX_REQUEST_BYTES,
} from "@/lib/server/chat/routeConstants";
import {
  buildSseResponseHeaders,
  requireChatUser,
} from "@/lib/server/chat/routeHelpers";
import { assertRequestSize, parseJsonRequest } from "@/lib/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildTitle(prompt) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) return "Fusion";
  return text.length > 30 ? `${text.slice(0, 30)}...` : text;
}

function normalizeMessageId(value) {
  return typeof value === "string" && value.trim() && value.length <= 128
    ? value.trim()
    : generateMessageId();
}

function createStreamErrorEvent(message) {
  return JSON.stringify({
    type: "stream_error",
    message: message || "Unknown error",
  });
}

export async function POST(req) {
  await dbConnect();

  const oversizeResponse = assertRequestSize(req, MAX_REQUEST_BYTES);
  if (oversizeResponse) return oversizeResponse;

  const parsed = await parseJsonRequest(req, "Invalid JSON in request body");
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const {
    prompt,
    model,
    config,
    conversationId,
    userMessageId,
    modelMessageId,
    history,
    mode,
  } = body || {};
  const requestImages = Array.isArray(config?.images) ? config.images : [];
  const requestAttachments = Array.isArray(config?.attachments) ? config.attachments : [];

  if (model !== FUSION_MODEL_ID) {
    return Response.json({ error: "Fusion 模式请求无效" }, { status: 400 });
  }
  if (!Array.isArray(history)) {
    return Response.json({ error: "history must be an array" }, { status: 400 });
  }
  if (mode) {
    return Response.json({ error: "Fusion 模式不支持该操作" }, { status: 400 });
  }
  if (requestImages.length > 0) {
    return Response.json({ error: "Fusion 当前只支持文字输入" }, { status: 400 });
  }
  if (requestAttachments.length > 0) {
    return Response.json({ error: "Fusion 当前只支持文字输入" }, { status: 400 });
  }

  const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
  if (authResult?.response) return authResult.response;
  const auth = authResult.auth;

  let promptText = typeof prompt === "string" ? prompt : "";
  let fusionInput = null;
  let currentConversation = null;
  let createdConversationForRequest = false;

  if (conversationId != null) {
    if (!mongoose.isValidObjectId(conversationId)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    currentConversation = await Conversation.findOne({
      _id: conversationId,
      userId: auth.userId,
    }).lean();
    if (!currentConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (currentConversation.model !== FUSION_MODEL_ID) {
      return Response.json({ error: "Fusion 对话不存在" }, { status: 400 });
    }
  }

  if (!currentConversation) {
    if (!promptText.trim() && requestImages.length === 0) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    try {
      fusionInput = await buildFusionUserInput({
        prompt: promptText,
        images: requestImages,
      });
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(fusionInput.userParts) || fusionInput.userParts.length === 0) {
      return Response.json({ error: "Fusion 输入不能为空" }, { status: 400 });
    }

    const createdConversation = await Conversation.create({
      userId: auth.userId,
      title: buildTitle(promptText),
      model: FUSION_MODEL_ID,
      messages: [],
      settings: {},
    });
    currentConversation = createdConversation.toObject();
    createdConversationForRequest = true;
  }

  const currentConversationId = currentConversation._id.toString();
  const previousMessages = Array.isArray(currentConversation.messages) ? currentConversation.messages : [];
  const previousUpdatedAt = currentConversation.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
  const resolvedUserMessageId = normalizeMessageId(userMessageId);
  const resolvedModelMessageId = normalizeMessageId(modelMessageId);

  const completedRounds = countCompletedFusionRounds(previousMessages);
  if (completedRounds >= FUSION_MAX_ROUNDS) {
    return Response.json(
      { error: "Fusion 只支持一轮会话，请新建对话继续。" },
      { status: 400 }
    );
  }

  if (!fusionInput) {
    if (!promptText.trim() && requestImages.length === 0) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    try {
      fusionInput = await buildFusionUserInput({
        prompt: promptText,
        images: requestImages,
      });
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(fusionInput.userParts) || fusionInput.userParts.length === 0) {
      return Response.json({ error: "Fusion 输入不能为空" }, { status: 400 });
    }
  }

  const historyMemo = buildFusionHistoryMemo(previousMessages);

  const enrichedUserParts = await enrichConversationPartsWithBlobIds(fusionInput.userParts, {
    userId: auth.userId,
  });

  const storedUserMessage = {
    id: resolvedUserMessageId,
    role: "user",
    content: promptText,
    type: "parts",
    parts: enrichedUserParts,
  };

  const userMsgTime = Date.now();
  const updatedConversation = await Conversation.findOneAndUpdate(
    { _id: currentConversationId, userId: auth.userId },
    {
      $set: { updatedAt: userMsgTime },
      $push: { messages: storedUserMessage },
    },
    { new: true }
  ).select("updatedAt");
  if (!updatedConversation) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  let writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? userMsgTime;

  let clientAborted = false;
  const onAbort = () => {
    clientAborted = true;
  };
  try {
    req?.signal?.addEventListener?.("abort", onAbort, { once: true });
  } catch {
    // ignore
  }

  const responseStream = new ReadableStream({
    async start(controller) {
      const streamHelpers = createFusionStreamHelpers(controller);
      let finalMessagePersisted = false;
      const fusionSignal = req?.signal;
      const rollbackFusionTurn = async () => {
        if (finalMessagePersisted) return;

        const writeCondition = buildConversationWriteCondition(
          currentConversationId,
          auth.userId,
          writePermitTime
        );

        if (createdConversationForRequest) {
          await Conversation.deleteOne(writeCondition);
          return;
        }

        await Conversation.findOneAndUpdate(
          writeCondition,
          {
            $pull: {
              messages: { id: resolvedUserMessageId },
            },
            $set: {
              updatedAt: previousUpdatedAt,
            },
          }
        );
      };

      let resultState = buildFusionResultState({
        status: "pending",
        phase: "pending",
        message: "等待对比分析完成",
      });

      try {
        resultState = buildFusionResultState({
          status: "running",
          phase: "answering",
          message: "正在生成正式回复",
        });
        streamHelpers.sendFusionResultState(resultState);

        const { text: rawFusionAnswer, citations: finalCitations } = await runFusionAnswer({
          historyMemo,
          prompt: promptText,
          signal: fusionSignal,
        });
        const parsedFusionAnswer = parseNativeFusionMarkdown(rawFusionAnswer);
        const finalAnswer = parsedFusionAnswer.content || rawFusionAnswer;

        if (clientAborted) {
          throw new Error("FUSION_ABORTED");
        }

        const finalMessage = buildFusionFinalMessage({
          modelMessageId: resolvedModelMessageId,
          content: finalAnswer,
          experts: parsedFusionAnswer.experts,
          analysis: parsedFusionAnswer.analysis,
          citations: finalCitations,
        });

        const persistedConversation = await Conversation.findOneAndUpdate(
          buildConversationWriteCondition(currentConversationId, auth.userId, writePermitTime),
          {
            $set: { updatedAt: Date.now() },
            $push: { messages: finalMessage },
          },
          { new: true }
        ).select("updatedAt");
        if (!persistedConversation) {
          throw new Error(CONVERSATION_WRITE_CONFLICT_ERROR);
        }
        finalMessagePersisted = true;
        writePermitTime = persistedConversation.updatedAt?.getTime?.() ?? Date.now();

        if (parsedFusionAnswer.experts.length > 0) {
          streamHelpers.sendFusionExperts(parsedFusionAnswer.experts);
        }
        if (parsedFusionAnswer.analysis) {
          streamHelpers.sendFusionAnalysisResult(parsedFusionAnswer.analysis);
        }
        streamHelpers.sendFusionResult(finalMessage.content);
        streamHelpers.sendCitations(finalMessage.citations);
        resultState = buildFusionResultState({
          status: "done",
          phase: "done",
          message: "已完成",
        });
        streamHelpers.sendFusionResultState(resultState);
        streamHelpers.sendDone();
        controller.close();
      } catch (error) {
        try {
          const errorMessage = error?.message === "FUSION_ABORTED"
            ? "已停止"
            : (error?.message || "执行失败");
          if (resultState.status === "running" || resultState.phase === "answering") {
            streamHelpers.sendFusionResultState(buildFusionResultState({
              status: "error",
              phase: "error",
              message: errorMessage,
            }));
          }
        } catch {
          // ignore stream state send failure
        }
        try {
          await rollbackFusionTurn();
        } catch {
          // ignore rollback failure
        }
        if (clientAborted || error?.message === "FUSION_ABORTED") {
          try {
            controller.close();
          } catch {
            // ignore
          }
          return;
        }
        try {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`data: ${createStreamErrorEvent(error?.message || "Fusion 执行失败")}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          controller.error(error);
        }
      } finally {
        try {
          req?.signal?.removeEventListener?.("abort", onAbort);
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(responseStream, {
    headers: buildSseResponseHeaders(currentConversationId),
  });
}
