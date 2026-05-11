import mongoose from "mongoose";
import Conversation from "@/models/Conversation";
import { generateMessageId, sanitizeStoredMessagesStrict } from "@/app/api/chat/utils";
import {
  COUNCIL_MAX_ROUNDS,
  COUNCIL_MODEL_ID,
  countCompletedCouncilRounds,
  modelSupportsAvailableInput,
} from "@/lib/shared/models";
import { resolveCouncilProviderRoutes } from "@/lib/modelRoutes";
import {
  buildCouncilAnalysisState,
  buildCouncilExpertState,
  buildCouncilFinalMessage,
  buildCouncilHistoryMemo,
  buildCouncilResultState,
  buildCouncilUserInput,
  buildCouncilUserInputFromMessage,
  COUNCIL_EXPERT_CONFIGS,
  runCouncilExpert,
  runSeedCouncilAnalysis,
  runSeedCouncilFinalAnswer,
  runSeedTriage,
} from "./councilHelpers";
import { createCouncilStreamHelpers } from "./streamHelpers";
import {
  enrichConversationPartsWithBlobIds,
  enrichStoredMessagesWithBlobIds,
} from "@/lib/server/conversations/blobReferences";
import {
  CONVERSATION_WRITE_CONFLICT_ERROR,
  buildConversationWriteCondition,
} from "@/app/api/chat/conversationState";
import {
  CHAT_RATE_LIMIT,
  MAX_REQUEST_BYTES,
} from '@/lib/server/chat/routeConstants';
import {
  buildSseResponseHeaders,
  requireChatUser,
} from "@/lib/server/chat/routeHelpers";
import { assertRequestSize, parseJsonRequest } from "@/lib/server/api/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_COUNCIL_EXPERTS = 3;
const MAX_EXPERT_MODEL_CHARS = 100;
const MAX_EXPERT_LABEL_CHARS = 120;
const MAX_EXPERT_CONTENT_CHARS = 20000;
const MAX_ANALYSIS_ITEM_CHARS = 2000;
const COUNCIL_ANALYSIS_GROUP_KEYS = ["agreement", "keyDifferences", "partialCoverage", "uniqueInsights", "blindSpots"];
const COUNCIL_ANALYSIS_MODELS = new Set(["GPT", "Claude", "Gemini"]);

function buildTitle(prompt) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) return "Council";
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeCouncilExperts(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_COUNCIL_EXPERTS) {
    throw new Error(`${fieldPath} too many`);
  }
  const experts = [];
  for (const [index, expert] of value.entries()) {
    if (!isPlainObject(expert)) continue;
    const modelId = typeof expert.modelId === "string" ? expert.modelId.trim() : "";
    const label = typeof expert.label === "string" ? expert.label.trim() : "";
    const content = typeof expert.content === "string" ? expert.content : "";
    if (!modelId || modelId.length > MAX_EXPERT_MODEL_CHARS) {
      throw new Error(`${fieldPath}[${index}].modelId invalid`);
    }
    if (!label || label.length > MAX_EXPERT_LABEL_CHARS) {
      throw new Error(`${fieldPath}[${index}].label invalid`);
    }
    if (!content || content.length > MAX_EXPERT_CONTENT_CHARS) {
      throw new Error(`${fieldPath}[${index}].content invalid`);
    }
    const nextExpert = { modelId, label, content };
    if (Number.isFinite(expert.durationMs) && expert.durationMs >= 0) {
      nextExpert.durationMs = Math.max(0, Math.floor(expert.durationMs));
    }
    if (Array.isArray(expert.citations) && expert.citations.length > 0) {
      nextExpert.citations = expert.citations;
    }
    experts.push(nextExpert);
  }
  return experts;
}

function sanitizeCouncilAnalysis(value, fieldPath) {
  if (!isPlainObject(value)) return null;
  const result = {};

  for (const key of COUNCIL_ANALYSIS_GROUP_KEYS) {
    const rawItems = Array.isArray(value[key]) ? value[key] : [];
    result[key] = rawItems
      .filter((item) => isPlainObject(item))
      .map((item, index) => {
        const text = typeof item.text === "string" ? item.text.trim().slice(0, MAX_ANALYSIS_ITEM_CHARS) : "";
        if (!text) {
          throw new Error(`${fieldPath}.${key}[${index}].text invalid`);
        }
        const models = Array.isArray(item.models)
          ? Array.from(new Set(
              item.models
                .filter((model) => typeof model === "string")
                .map((model) => model.trim())
                .filter((model) => COUNCIL_ANALYSIS_MODELS.has(model))
            ))
          : [];
        return { text, models };
      });
  }

  return result;
}

async function sanitizeCouncilRegenerateMessages(messages, userId) {
  const sanitized = sanitizeStoredMessagesStrict(messages);
  const enrichedMessages = await enrichStoredMessagesWithBlobIds(sanitized, { userId });
  return enrichedMessages.map((message, index) => {
    const original = messages[index];
    const nextMessage = { ...message };
    const experts = sanitizeCouncilExperts(original?.councilExperts, `messages[${index}].councilExperts`);
    if (experts.length > 0) {
      nextMessage.councilExperts = experts;
    }
    const analysis = sanitizeCouncilAnalysis(original?.councilAnalysis, `messages[${index}].councilAnalysis`);
    if (analysis) {
      nextMessage.councilAnalysis = analysis;
    }
    return nextMessage;
  });
}

export async function POST(req) {
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
    messages,
  } = body || {};
  const requestImages = Array.isArray(config?.images) ? config.images : [];
  const requestAttachments = Array.isArray(config?.attachments) ? config.attachments : [];

  if (model !== COUNCIL_MODEL_ID) {
    return Response.json({ error: "Council 模式请求无效" }, { status: 400 });
  }
  if (!Array.isArray(history)) {
    return Response.json({ error: "history must be an array" }, { status: 400 });
  }

  if (mode) {
    return Response.json({ error: "Council 模式不支持该操作" }, { status: 400 });
  }
  const isRegenerateMode = false;
  if (requestImages.length > 0 && !modelSupportsAvailableInput(COUNCIL_MODEL_ID, "image")) {
    return Response.json({ error: "Council 当前不支持图片输入" }, { status: 400 });
  }
  if (requestAttachments.length > 0) {
    return Response.json({ error: "Council 当前只支持文字和图片输入" }, { status: 400 });
  }

  const authResult = await requireChatUser(req, CHAT_RATE_LIMIT);
  if (authResult?.response) return authResult.response;
  const auth = authResult.auth;

  let providerRoutes;
  try {
    providerRoutes = resolveCouncilProviderRoutes();
  } catch (error) {
    return Response.json({ error: error?.message || "模型线路配置错误" }, { status: 500 });
  }

  let promptText = typeof prompt === "string" ? prompt : "";
  let councilInput = null;
  let currentConversation = null;
  let createdConversationForRequest = false;

  if (!isRegenerateMode && conversationId == null) {
    if (!promptText.trim() && requestImages.length === 0) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    try {
      councilInput = await buildCouncilUserInput({
        prompt: promptText,
        images: requestImages,
      });
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
      return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
    }
  }

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
    if (currentConversation.model !== COUNCIL_MODEL_ID) {
      return Response.json({ error: "Council 对话不存在" }, { status: 400 });
    }
  }

  if (!currentConversation) {
    const createdConversation = await Conversation.create({
      userId: auth.userId,
      title: buildTitle(promptText),
      model: COUNCIL_MODEL_ID,
      messages: [],
      settings: {},
    });
    currentConversation = createdConversation.toObject();
    createdConversationForRequest = true;
  }

  if (!currentConversation) {
    return Response.json({ error: "conversationId missing" }, { status: 400 });
  }

  const currentConversationId = currentConversation._id.toString();
  const previousMessages = Array.isArray(currentConversation.messages) ? currentConversation.messages : [];
  const previousUpdatedAt = currentConversation.updatedAt ? new Date(currentConversation.updatedAt) : new Date();
  const resolvedUserMessageId = normalizeMessageId(userMessageId);
  const resolvedModelMessageId = normalizeMessageId(modelMessageId);
  let historyMemo = "";
  let writePermitTime = previousUpdatedAt?.getTime?.();

  if (isRegenerateMode) {
    let sanitizedMessages;
    try {
      sanitizedMessages = await sanitizeCouncilRegenerateMessages(messages, auth.userId);
    } catch (error) {
      return Response.json({ error: error?.message || "Council 快照无效" }, { status: 400 });
    }
    if (sanitizedMessages.length === 0) {
      return Response.json({ error: "Council 快照不能为空" }, { status: 400 });
    }

    const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];
    if (lastMessage?.role !== "user") {
      return Response.json({ error: "Council 重开快照必须以用户消息结尾" }, { status: 400 });
    }

    try {
      councilInput = await buildCouncilUserInputFromMessage(lastMessage);
    } catch (error) {
      return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
    }
    if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
      return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
    }

    promptText = councilInput.prompt || "";
    historyMemo = buildCouncilHistoryMemo(sanitizedMessages.slice(0, -1));

    const regenerateTime = Date.now();
    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: currentConversationId, userId: auth.userId },
      {
        $set: {
          messages: sanitizedMessages,
          updatedAt: regenerateTime,
        },
      },
      { new: true }
    ).select("updatedAt");
    if (!updatedConversation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? regenerateTime;
  } else {
    const completedRounds = countCompletedCouncilRounds(previousMessages);
    if (completedRounds >= COUNCIL_MAX_ROUNDS) {
      return Response.json(
        { error: `Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，请新建对话继续。` },
        { status: 400 }
      );
    }

    if (!councilInput) {
      if (!promptText.trim() && requestImages.length === 0) {
        return Response.json({ error: "Prompt is required" }, { status: 400 });
      }
      try {
        councilInput = await buildCouncilUserInput({
          prompt: promptText,
          images: requestImages,
        });
      } catch (error) {
        return Response.json({ error: error?.message || "图片处理失败" }, { status: 400 });
      }
      if (!Array.isArray(councilInput.userParts) || councilInput.userParts.length === 0) {
        return Response.json({ error: "Council 输入不能为空" }, { status: 400 });
      }
    }

    historyMemo = buildCouncilHistoryMemo(previousMessages);

    const enrichedUserParts = await enrichConversationPartsWithBlobIds(councilInput.userParts, {
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
    writePermitTime = updatedConversation.updatedAt?.getTime?.() ?? userMsgTime;
  }

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
      const streamHelpers = createCouncilStreamHelpers(controller);
      let finalMessagePersisted = false;
      const councilSignal = req?.signal;
      const rollbackCouncilTurn = async () => {
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

        if (isRegenerateMode) {
          await Conversation.findOneAndUpdate(
            writeCondition,
            {
              $set: {
                messages: previousMessages,
                updatedAt: previousUpdatedAt,
              },
            }
          );
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

      let analysisState = buildCouncilAnalysisState({
        status: "pending",
        phase: "pending",
        message: "等待来源完成",
      });
      let resultState = buildCouncilResultState({
        status: "pending",
        phase: "pending",
        message: "等待对比分析完成",
      });

      try {
        // ── Seed Triage：预判是否需要启动 Council ──
        const hasImages = Array.isArray(councilInput.imagePayloads) && councilInput.imagePayloads.length > 0;
        const skipTriage = isRegenerateMode || hasImages;
        let triageResult = { needCouncil: true };

        if (!skipTriage) {
          triageResult = await runSeedTriage({ prompt: promptText, hasImages, signal: councilSignal });
        }

        if (!triageResult.needCouncil && triageResult.directAnswer) {
          resultState = buildCouncilResultState({
            status: "running",
            phase: "answering",
            message: "正在生成正式回复",
          });
          const answer = triageResult.directAnswer;
          streamHelpers.sendCouncilResultState(resultState);

          if (clientAborted) {
            throw new Error("COUNCIL_ABORTED");
          }

          const finalMessage = buildCouncilFinalMessage({
            modelMessageId: resolvedModelMessageId,
            content: answer,
            experts: [],
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

          streamHelpers.sendCouncilResult(finalMessage.content);
          resultState = buildCouncilResultState({
            status: "done",
            phase: "done",
            message: "已完成",
          });
          streamHelpers.sendCouncilResultState(resultState);
          streamHelpers.sendDone();
          controller.close();
          return;
        }

        const expertStateMap = new Map(
          COUNCIL_EXPERT_CONFIGS.map((expert) => [expert.key, buildCouncilExpertState(expert, {
            status: "pending",
            phase: "pending",
            message: "等待开始",
          })])
        );
        streamHelpers.sendCouncilExpertStates(Array.from(expertStateMap.values()));

        const updateExpertState = (expert, patch) => {
          const nextState = buildCouncilExpertState(expert, {
            ...expertStateMap.get(expert.key),
            ...patch,
          });
          expertStateMap.set(expert.key, nextState);
          try {
            streamHelpers.sendCouncilExpertState(nextState);
          } catch {
            // ignore stream state send failure
          }
        };

        // ── 复杂问题：走完整 Council 流程 ──
        const experts = await Promise.all(
          COUNCIL_EXPERT_CONFIGS.map((expert) =>
            runCouncilExpert({
              prompt: promptText,
              historyMemo,
              imagePayloads: councilInput.imagePayloads,
              expert,
              clientAborted: () => clientAborted,
              updateStatus: (patch) => updateExpertState(expert, patch),
              providerRoutes,
              signal: councilSignal,
              onDone: (result) => {
                try {
                  streamHelpers.sendCouncilExpertResult(result);
                } catch {
                  // ignore
                }
              },
            })
          )
        );

        if (clientAborted) {
          throw new Error("COUNCIL_ABORTED");
        }

        analysisState = buildCouncilAnalysisState({
          status: "running",
          phase: "thinking",
          message: "正在分析三位专家观点",
        });
        streamHelpers.sendCouncilAnalysisState(analysisState);
        const analysis = await runSeedCouncilAnalysis({
          historyMemo,
          prompt: promptText,
          experts,
          signal: councilSignal,
        });
        streamHelpers.sendCouncilAnalysisResult(analysis);
        analysisState = buildCouncilAnalysisState({
          status: "done",
          phase: "done",
          message: "已完成",
        });
        streamHelpers.sendCouncilAnalysisState(analysisState);

        if (clientAborted) {
          throw new Error("COUNCIL_ABORTED");
        }

        resultState = buildCouncilResultState({
          status: "running",
          phase: "answering",
          message: "正在生成正式回复",
        });
        streamHelpers.sendCouncilResultState(resultState);

        const finalAnswer = await runSeedCouncilFinalAnswer({
          historyMemo,
          prompt: promptText,
          experts,
          analysis,
          signal: councilSignal,
        });

        if (clientAborted) {
          throw new Error("COUNCIL_ABORTED");
        }

        const finalMessage = buildCouncilFinalMessage({
          modelMessageId: resolvedModelMessageId,
          content: finalAnswer,
          experts,
          analysis,
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

        streamHelpers.sendCouncilResult(finalMessage.content);
        resultState = buildCouncilResultState({
          status: "done",
          phase: "done",
          message: "已完成",
        });
        streamHelpers.sendCouncilResultState(resultState);
        streamHelpers.sendDone();
        controller.close();
      } catch (error) {
        try {
          const errorMessage = error?.message === "COUNCIL_ABORTED"
            ? "已停止"
            : (error?.message || "执行失败");
          if (resultState.status === "running" || resultState.phase === "answering") {
            streamHelpers.sendCouncilResultState(buildCouncilResultState({
              status: "error",
              phase: "error",
              message: errorMessage,
            }));
          } else if (analysisState.status === "running" || analysisState.phase === "thinking") {
            streamHelpers.sendCouncilAnalysisState(buildCouncilAnalysisState({
              status: "error",
              phase: "error",
              message: errorMessage,
            }));
          }
        } catch {
          // ignore stream state send failure
        }
        try {
          await rollbackCouncilTurn();
        } catch {
          // ignore rollback failure
        }
        if (clientAborted || error?.message === "COUNCIL_ABORTED") {
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
            encoder.encode(`data: ${createStreamErrorEvent(error?.message || "Council 执行失败")}\n\n`)
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
