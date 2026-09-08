"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { decorateConversationMessages } from "@/lib/client/chat/conversationMessages";
import { playCompletionSound, unlockCompletionSound } from "@/lib/client/chat/completionSound";

const ACTIVE = new Set(["queued", "running", "waiting_media"]);

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || "无法读取对话进度"); error.status = response.status; throw error; }
  return data;
}

export function useConversationTasks({
  user, conversationId, projectId, model, webSearch, chatSystemPrompt, mediaSettings,
  setMessages, setCurrentConversationId, onActivity, onCreditChange, onAuthExpired, toast, completionSoundVolume,
}) {
  const [tasks, setTasks] = useState([]);
  const [limits, setLimits] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const currentId = useRef(conversationId);
  const lock = useRef(false);
  const previousStatuses = useRef(new Map());
  const applyUpdate = useEffectEvent((conversation, nextTasks) => {
    const byId = new Map(nextTasks.map(task => [task._id, task]));
    setMessages(decorateConversationMessages(conversation.messages.map(message => {
      const task = byId.get(String(message.taskId));
      return task ? { ...message, taskStatus: task.status, content: task.output, thought: task.thought, artifacts: task.artifacts, citations: task.citations } : message;
    })));
    setTasks(nextTasks);
    for (const task of nextTasks) {
      const previous = previousStatuses.current.get(task._id);
      if (previous && ACTIVE.has(previous) && !ACTIVE.has(task.status)) {
        if (task.status === "completed") playCompletionSound(completionSoundVolume);
        onCreditChange();
        onActivity();
      }
      previousStatuses.current.set(task._id, task.status);
    }
  });
  const reportError = useEffectEvent((error) => { if (error.status === 401) onAuthExpired(); else toast.error(error.message); });
  useEffect(() => {
    currentId.current = conversationId;
    let disposed = false;
    let timer;
    async function poll() {
      if (!user || !conversationId) {
        if (!disposed) setTasks([]);
        return;
      }
      try {
        const [conversationData, taskData] = await Promise.all([
          fetch(`/api/conversations/${conversationId}`, { cache: "no-store" }).then(readResponse),
          fetch(`/api/tasks?conversationId=${conversationId}`, { cache: "no-store" }).then(readResponse),
        ]);
        if (disposed) return;
        setLimits(taskData.limits);
        applyUpdate(conversationData.conversation, taskData.tasks);
        if (taskData.tasks.some(task => ACTIVE.has(task.status) || task.mediaTasks?.some(media => !["completed", "failed", "canceled"].includes(media.status)))) {
          timer = setTimeout(poll, 1200);
        }
      } catch (error) {
        if (!disposed) { error.message = `${error.message}，请重新打开这段对话查看进度`; reportError(error); }
      }
    }
    timer = setTimeout(poll, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [user, conversationId, revision]);

  async function send({ text, attachments = [], replaceFromMessageId } = {}) {
    if (lock.current) return false;
    if (!text?.trim() && !attachments.length) return false;
    lock.current = true;
    setSubmitting(true);
    unlockCompletionSound();
    const sourceId = conversationId;
    try {
      const data = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId, projectId, model, webSearch, chatSystemPrompt, mediaSettings,
          prompt: text?.trim() || "请分析附件", attachments: attachments.map(item => ({ fileId: item.fileId })),
          requestId: crypto.randomUUID(), ...(replaceFromMessageId ? { replaceFromMessageId } : {}),
        }),
      }).then(readResponse);
      if (currentId.current === sourceId) {
        currentId.current = data.conversation._id;
        setCurrentConversationId(data.conversation._id);
        setMessages(decorateConversationMessages(data.conversation.messages));
        setTasks(previous => [data.task, ...previous.filter(task => task._id !== data.task._id)]);
        previousStatuses.current.set(data.task._id, data.task.status);
        setRevision(value => value + 1);
      }
      onActivity();
      return true;
    } catch (error) {
      if (error.status === 401) onAuthExpired(); else toast.error(error.message);
      return false;
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  async function stop() {
    const task = tasks.find(item => ACTIVE.has(item.status) && item.conversationId === conversationId);
    if (!task) return;
    try {
      await fetch(`/api/tasks/${task._id}/stop`, { method: "POST" }).then(readResponse);
      setRevision(value => value + 1);
    } catch (error) { toast.error(error.message); }
  }

  async function deleteMessage(messageId) {
    try {
      await fetch(`/api/conversations/${conversationId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteMessageId: messageId }),
      }).then(readResponse);
      setRevision(value => value + 1);
      onActivity();
    } catch (error) { toast.error(error.message); }
  }
  return { limits, tasks: tasks.filter(task => task.conversationId === conversationId), submitting, send, stop, deleteMessage };
}
