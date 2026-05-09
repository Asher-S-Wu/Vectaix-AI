// ChatApp - 主聊天应用组件
"use client";
import { useEffect, useRef, useState } from "react";
import { createChatAppActions } from "@/lib/client/chat/chatAppActions";
import {
  decorateConversationMessages,
  mergeConversationMessages,
} from "@/lib/client/chat/conversationMessages";
import { useThemeMode } from "@/lib/client/hooks/useThemeMode";
import { useUserSettings } from "@/lib/client/hooks/useUserSettings";
import { normalizeWebSearchSettings } from "@/lib/shared/webSearch";
import {
  getModelConfig,
  CHAT_RUNTIME_MODE_CHAT,
  COUNCIL_MODEL_ID,
  DEFAULT_MODEL,
  isCouncilModel,
  isPrimaryChatModelId,
  resolveUsableModelId,
} from "@/lib/shared/models";
import { useToast } from "./components/ToastProvider";
import AuthModal from "./components/AuthModal";
import ConfirmModal from "./components/ConfirmModal";
import ChatLayout from "./components/ChatLayout";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
export default function ChatApp() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const mediaResolution = "MEDIA_RESOLUTION_HIGH";
  const {
    model,
    isSettingsReady,
    setModel,
    setChatMode,
    thinkingLevels,
    historyLimit,
    maxTokens,
    webSearch,
    setWebSearch,
    chatSystemPrompt,
    setChatSystemPrompt,
    systemPrompts,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    themeMode,
    setThemeMode,
    fontSize,
    setFontSize,
    completionSoundVolume,
    setCompletionSoundVolume,
    settingsError,
    setSettingsError,
    fetchSettings,
    avatar,
    setAvatar,
    nickname,
    setNickname,
  } = useUserSettings();
  useThemeMode(themeMode);
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingImageAction, setEditingImageAction] = useState("keep");
  const [editingImage, setEditingImage] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState({ text: "", nonce: 0 });
  const [serverSettingsReady, setServerSettingsReady] = useState(false);

  const chatEndRef = useRef(null);
  const messageListRef = useRef(null);
  const userInterruptedRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);
  const scrollRafRef = useRef(0);
  const chatAbortRef = useRef(null);
  const chatRequestLockRef = useRef(false);
  const syncSettingsTimeoutRef = useRef(null);
  const pendingSettingsRef = useRef({});
  const pendingConversationIdRef = useRef(null);
  const lastTextModelRef = useRef(DEFAULT_MODEL);
  const hasRestoredConversationRef = useRef(false);
  const currentConversationIdRef = useRef(null);
  const isStreamingRef = useRef(false);
  const isStreaming = messages.some((message) => message?.isStreaming === true);
  isStreamingRef.current = isStreaming;
  const SCROLL_BOTTOM_THRESHOLD = 80;
  const lastSettingsErrorRef = useRef(null);

  useEffect(() => {
    if (settingsError && settingsError !== lastSettingsErrorRef.current) {
      toast.error(settingsError);
      lastSettingsErrorRef.current = settingsError;
    }
  }, [settingsError, toast]);

  const stopOngoingChatWork = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    userInterruptedRef.current = false;
    if (syncSettingsTimeoutRef.current) {
      clearTimeout(syncSettingsTimeoutRef.current);
      syncSettingsTimeoutRef.current = null;
    }
    pendingSettingsRef.current = {};
    pendingConversationIdRef.current = null;
    setLoading(false);
  };

  const handleAuthExpired = () => {
    stopOngoingChatWork();
    hasRestoredConversationRef.current = false;
    setServerSettingsReady(false);
    setUser(null);
    setConversations([]);
    setCurrentConversationId(null);
    setMessages([]);
    setSettingsError(null);
    setShowProfileModal(false);
    setShowAuthModal(true);
    setAuthMode("login");
    setPassword("");
    setConfirmPassword("");
  };

  const distanceToBottom = (el) => {
    if (!el) return 0;
    const top = Number.isFinite(el.scrollTop) ? el.scrollTop : 0;
    const height = Number.isFinite(el.clientHeight) ? el.clientHeight : 0;
    const scrollHeight = Number.isFinite(el.scrollHeight) ? el.scrollHeight : 0;
    return Math.max(0, scrollHeight - (top + height));
  };

  const isNearBottom = (el) => distanceToBottom(el) <= SCROLL_BOTTOM_THRESHOLD;

  const scrollToBottom = () => {
    const el = messageListRef.current;
    if (!el) return;
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = top;
  };

  const scheduleScrollToBottom = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      scrollToBottom();
    });
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          fetchConversations();
          Promise.resolve(fetchSettings()).finally(() => {
            setServerSettingsReady(true);
          });
        } else {
          handleAuthExpired();
        }
      })
      .catch(() => {
        handleAuthExpired();
      });
  }, []);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
    if (typeof window === "undefined") return;
    if (currentConversationId) {
      window.localStorage.setItem("vectaix-current-conversation", currentConversationId);
      return;
    }
    window.localStorage.removeItem("vectaix-current-conversation");
  }, [currentConversationId]);

  useEffect(() => {
    if (!user || !serverSettingsReady || hasRestoredConversationRef.current || conversations.length === 0) return;
    hasRestoredConversationRef.current = true;
    if (typeof window === "undefined") return;
    const savedConversationId = window.localStorage.getItem("vectaix-current-conversation");
    if (!savedConversationId) return;
    const exists = conversations.some((conversation) => conversation?._id === savedConversationId);
    if (exists) {
      loadConversation(savedConversationId, { silent: true });
    }
  }, [conversations, serverSettingsReady, user]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
      if (syncSettingsTimeoutRef.current) {
        clearTimeout(syncSettingsTimeoutRef.current);
        syncSettingsTimeoutRef.current = null;
      }
      pendingSettingsRef.current = {};
      pendingConversationIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!wasStreamingRef.current && isStreaming) {
      userInterruptedRef.current = false;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (userInterruptedRef.current) return;
    // 等待 DOM/Markdown 渲染完毕后执行滚动，提升移动端键盘弹出时的体验稳定性
    scheduleScrollToBottom();
    if (!isStreaming) return;
    const t = setTimeout(() => {
      if (userInterruptedRef.current) return;
      scrollToBottom();
    }, 60);
    return () => clearTimeout(t);
  }, [messages, isStreaming]);

  const handleMessageListScroll = () => {
    const el = messageListRef.current;
    if (!el) return;

    // 更新滚动到底部按钮的显示状态
    setShowScrollButton(!isNearBottom(el));

    if (isStreaming) {
      const top = el.scrollTop;
      const last = lastScrollTopRef.current;
      lastScrollTopRef.current = top;
      if (isNearBottom(el)) {
        userInterruptedRef.current = false;
        return;
      }
      // 只在"用户真实手势导致的上滑"时才中断自动滚动，避免移动端键盘/地址栏/回流引起的误判
      const recentUserGesture = Date.now() - lastUserScrollAtRef.current < 800;
      const moved = Math.abs(top - last) > 2;
      if (recentUserGesture && moved) userInterruptedRef.current = true;
    }
  };

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    let touchStartY = 0;
    let touchStartScrollTop = 0;
    const markUserGesture = () => {
      lastUserScrollAtRef.current = Date.now();
    };
    // 记录触摸开始时的位置和滚动位置
    const handleTouchStart = (e) => {
      lastUserScrollAtRef.current = Date.now();
      touchStartY = e.touches?.[0]?.clientY;
      touchStartScrollTop = el.scrollTop;
    };
    // 移动端触摸滑动时：检测向上滑动意图（手指向下移动 = 内容向上滚动）
    const handleTouchMove = (e) => {
      lastUserScrollAtRef.current = Date.now();
      if (!isStreamingRef.current) return;
      const currentY = e.touches?.[0]?.clientY;
      const deltaY = currentY - touchStartY;
      // deltaY > 0 表示手指向下移动，即用户想向上滚动查看历史
      // 同时检测 scrollTop 是否减少或用户意图明显（移动超过 10px）
      if (deltaY > 10 || el.scrollTop < touchStartScrollTop - 5) {
        userInterruptedRef.current = true;
      }
    };
    // 电脑端滚轮向上滚动时，直接标记为用户中断
    const handleWheel = (e) => {
      lastUserScrollAtRef.current = Date.now();
      // deltaY < 0 表示向上滚动
      if (isStreamingRef.current && e.deltaY < 0) {
        userInterruptedRef.current = true;
      }
    };
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("mousedown", markUserGesture);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", markUserGesture);
    };
  }, []);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      if (!isStreamingRef.current) return;
      if (userInterruptedRef.current) return;
      scrollToBottom();
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    setAuthLoading(true);
    const endpoint =
      authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { email, password, confirmPassword };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success || data.user) {
        stopOngoingChatWork();
        hasRestoredConversationRef.current = false;
        setServerSettingsReady(false);
        setUser(data.user);
        setShowAuthModal(false);
        setAuthMode("login");
        setSettingsError(null);
        setPassword("");
        setConfirmPassword("");
        toast.success(authMode === "login" ? "登录成功" : "注册成功");
        fetchConversations();
        Promise.resolve(fetchSettings()).finally(() => {
          setServerSettingsReady(true);
        });
      } else {
        toast.error(data.error);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/me", { method: "DELETE" });
    stopOngoingChatWork();
    hasRestoredConversationRef.current = false;
    setServerSettingsReady(false);
    setUser(null);
    setMessages([]);
    setConversations([]);
    setCurrentConversationId(null);
    setSettingsError(null);
    // 清除登录表单敏感信息
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowAuthModal(true);
    setShowProfileModal(false);
  };

  const applyConversationSettings = (rawSettings) => {
    const settings = rawSettings && typeof rawSettings === "object"
      ? rawSettings
      : {};
    setChatMode(CHAT_RUNTIME_MODE_CHAT);
    setWebSearch(normalizeWebSearchSettings(settings.webSearch, { defaultEnabled: true }));
  };

  const sortConversations = (list) => {
    if (!Array.isArray(list)) return [];
    return list.slice().sort((a, b) => {
      const ap = a?.pinned ? 1 : 0;
      const bp = b?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const at = new Date(a?.updatedAt || 0).getTime();
      const bt = new Date(b?.updatedAt || 0).getTime();
      return bt - at;
    });
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        handleAuthExpired();
        return;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) return;
      let nextConversations = [];
      setConversations(() => {
        nextConversations = data?.conversations
          ? sortConversations(data.conversations)
          : [];
        return nextConversations;
      });
      if (currentConversationId && !nextConversations.some((conv) => conv._id === currentConversationId)) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch { }
  };

  const handleConversationMissing = () => {
    stopOngoingChatWork();
    setCurrentConversationId(null);
    setMessages([]);
    fetchConversations();
  };

  const handleSensitiveRefusal = (payload) => {
    const promptText = typeof payload === "string" ? payload : payload?.prompt;
    const shouldPrefill = typeof payload === "object" ? payload?.shouldPrefill !== false : true;
    toast.warning("消息包含敏感内容，请修改后重新尝试");
    if (shouldPrefill && typeof promptText === "string" && promptText.trim()) {
      setComposerPrefill({ text: promptText, nonce: Date.now() });
    }
  };

  const actions = createChatAppActions({
    toast,
    messages,
    setMessages,
    loading,
    setLoading,
    model,
    thinkingLevels,
    mediaResolution,
    maxTokens,
    webSearch,
    chatSystemPrompt,
    historyLimit,
    currentConversationId,
    setCurrentConversationId,
    fetchConversations,
    chatAbortRef,
    chatRequestLockRef,
    userInterruptedRef,
    editingMsgIndex,
    editingContent,
    editingImageAction,
    editingImage,
    setEditingMsgIndex,
    setEditingContent,
    setEditingImageAction,
    setEditingImage,
    completionSoundVolume,
    onSensitiveRefusal: handleSensitiveRefusal,
    onAuthExpired: handleAuthExpired,
    onConversationMissing: handleConversationMissing,
    onConversationActivity: () => {},
  });

  const persistConversationModel = async (conversationIdToUpdate, nextModel) => {
    if (!conversationIdToUpdate || !nextModel || isCouncilModel(nextModel)) return;
    try {
      await fetch(`/api/conversations/${conversationIdToUpdate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: nextModel }),
      });
      setConversations((prev) => prev.map((conversation) => (
        conversation?._id === conversationIdToUpdate
          ? { ...conversation, model: nextModel }
          : conversation
      )));
    } catch { }
  };

  const loadConversation = async (id, options = {}) => {
    const silent = options?.silent === true;
    if (currentConversationIdRef.current && currentConversationIdRef.current !== id && isStreamingRef.current) {
      stopOngoingChatWork();
    }
    if (!silent) {
      setLoading(true);
      setMessages([]); // 先清空消息，显示加载动画
      if (window.innerWidth < 768) setSidebarOpen(false); // 移动端立即折叠侧边栏
    }
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (res.status === 401) {
        handleAuthExpired();
        throw new Error("登录已过期，请重新登录");
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.status === 404) {
        setConversations((prev) => prev.filter((conv) => conv._id !== id));
        if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
        }
      }
      if (!res.ok) throw new Error(data?.error || "加载会话失败");
      if (data.conversation) {
        const conversation = data.conversation;
        if (silent && currentConversationIdRef.current && currentConversationIdRef.current !== id) {
          return;
        }
        userInterruptedRef.current = false;
        setMessages((prev) => {
          const serverMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
          return silent
            ? mergeConversationMessages(serverMessages, prev)
            : decorateConversationMessages(serverMessages);
        });
        setCurrentConversationId(id);

        const targetModel = resolveUsableModelId(conversation.model, model);

        if (targetModel !== model) {
          setModel(targetModel);
          if (!isCouncilModel(targetModel)) {
            lastTextModelRef.current = targetModel;
          }
        }

        applyConversationSettings(conversation.settings);
      }
    } catch (e) {
      if (!silent) {
        toast.error(`加载会话失败：${e?.message}`);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  // 同步对话参数到数据库（防抖，累积多个设置变更）
  const syncConversationSettings = (settingsUpdate) => {
    if (!currentConversationId || isCouncilModel(model)) return;
    // 如果切换了对话，清空之前的待同步设置（避免跨对话污染）
    if (pendingConversationIdRef.current && pendingConversationIdRef.current !== currentConversationId) {
      pendingSettingsRef.current = {};
      if (syncSettingsTimeoutRef.current) {
        clearTimeout(syncSettingsTimeoutRef.current);
        syncSettingsTimeoutRef.current = null;
      }
    }
    pendingConversationIdRef.current = currentConversationId;
    // 累积设置变更，而不是只保留最后一个
    pendingSettingsRef.current = { ...pendingSettingsRef.current, ...settingsUpdate };
    if (syncSettingsTimeoutRef.current) clearTimeout(syncSettingsTimeoutRef.current);
    syncSettingsTimeoutRef.current = setTimeout(async () => {
      const toSync = pendingSettingsRef.current;
      const targetId = pendingConversationIdRef.current;
      pendingSettingsRef.current = {};
      pendingConversationIdRef.current = null;
      if (!targetId) return;
      try {
        await fetch(`/api/conversations/${targetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: toSync }),
        });
      } catch { }
    }, 500);
  };

  const deleteConversation = async (id, e) => {
    e?.stopPropagation?.();
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch { }
  };

  const startNewChat = async () => {
    userInterruptedRef.current = false;
    stopOngoingChatWork();
    setCurrentConversationId(null);
    setMessages([]);
    if (!isPrimaryChatModelId(model)) {
      setModel(DEFAULT_MODEL);
      lastTextModelRef.current = DEFAULT_MODEL;
    }
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const getLastStandardModel = () => {
    const candidate = lastTextModelRef.current;
    if (isPrimaryChatModelId(candidate) && !isCouncilModel(candidate)) {
      return candidate;
    }
    return DEFAULT_MODEL;
  };

  const requestModeChange = (nextMode) => {
    if (loading || messages.some((m) => m.isStreaming)) return;

    if (nextMode === COUNCIL_MODEL_ID) {
      if (isCouncilModel(model)) return;

      const applyCouncilMode = () => {
        userInterruptedRef.current = false;
        setCurrentConversationId(null);
        setMessages([]);
        setModel(COUNCIL_MODEL_ID);
      };

      if (messages.length > 0) {
        setConfirmModalConfig({
          title: "切换模式",
          message: "切换到 Council 需要新建对话。Council 和普通模型不能在同一个会话里混用。\n\n是否新建对话并切换？",
          onConfirm: applyCouncilMode,
        });
        setShowConfirmModal(true);
        return;
      }

      applyCouncilMode();
      return;
    }

    // nextMode 是 chat（从 Council 切回普通模式）
    if (isCouncilModel(model)) {
      const fallbackModel = getLastStandardModel();
      const applyStandardMode = () => {
        userInterruptedRef.current = false;
        setCurrentConversationId(null);
        setMessages([]);
        setModel(fallbackModel);
        lastTextModelRef.current = fallbackModel;
        setChatMode(CHAT_RUNTIME_MODE_CHAT);
      };

      if (messages.length > 0) {
        setConfirmModalConfig({
          title: "切换模式",
          message: "切换到 Chat 需要新建对话。Council 和普通模型不能在同一个会话里混用。\n\n是否新建对话并切换？",
          onConfirm: applyStandardMode,
        });
        setShowConfirmModal(true);
        return;
      }

      applyStandardMode();
      return;
    }
  };

  const requestModelChange = (nextModel) => {
    if (loading || messages.some((m) => m.isStreaming)) return;

    const currentIsCouncil = isCouncilModel(model);
    const nextModelConfig = getModelConfig(nextModel);
    const nextIsCouncil = isCouncilModel(nextModel);

    if (messages.length > 0 && currentIsCouncil !== nextIsCouncil) {
      setConfirmModalConfig({
        title: "切换模型",
        message: `切换到 ${nextModelConfig?.name || "所选模型"} 需要新建对话。\nCouncil 和普通模型不能在同一个会话里混用。\n\n是否新建对话并切换模型？`,
        onConfirm: () => {
          userInterruptedRef.current = false;
          setCurrentConversationId(null);
          setMessages([]);
          setModel(nextModel);
          if (!nextIsCouncil) {
            lastTextModelRef.current = nextModel;
          }
        }
      });
      setShowConfirmModal(true);
      return;
    }

    setModel(nextModel);
    if (!nextIsCouncil) {
      lastTextModelRef.current = nextModel;
    }
    if (currentConversationId && !currentIsCouncil && !nextIsCouncil) {
      persistConversationModel(currentConversationId, nextModel);
    }
  };

  const renameConversation = async (id, newTitle) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setConversations((prev) =>
        prev.map((c) => (c._id === id ? { ...c, title: newTitle } : c))
      );
    } catch { }
  };

  const togglePinConversation = async (id, nextPinned) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      setConversations((prev) => {
        const next = prev.map((c) =>
          c._id === id ? { ...c, pinned: nextPinned, updatedAt: new Date().toISOString() } : c
        );
        return sortConversations(next);
      });
    } catch { }
  };

  const buildDuplicateTitle = (title) => {
    const sourceTitle = typeof title === "string" && title.trim() ? title.trim() : "新对话";
    const baseTitle = `${sourceTitle}（副本）`;
    const existingTitles = new Set(
      conversations
        .map((conv) => (typeof conv?.title === "string" ? conv.title.trim() : ""))
        .filter(Boolean)
    );
    if (!existingTitles.has(baseTitle)) return baseTitle;

    let index = 2;
    while (existingTitles.has(`${sourceTitle}（副本 ${index}）`)) {
      index += 1;
    }
    return `${sourceTitle}（副本 ${index}）`;
  };

  const duplicateConversation = async (id) => {
    try {
      const sourceRes = await fetch(`/api/conversations/${id}`);
      if (sourceRes.status === 401) {
        handleAuthExpired();
        return;
      }

      let sourceData = null;
      try {
        sourceData = await sourceRes.json();
      } catch {
        sourceData = null;
      }

      if (!sourceRes.ok) {
        throw new Error(sourceData?.error || "读取话题失败");
      }

      const sourceConversation = sourceData?.conversation;
      if (!sourceConversation) {
        throw new Error("未找到要复制的话题");
      }

      if (isCouncilModel(sourceConversation.model)) {
        return;
      }

      const createRes = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: buildDuplicateTitle(sourceConversation.title),
          model: sourceConversation.model,
          messages: Array.isArray(sourceConversation.messages) ? sourceConversation.messages : [],
          settings: sourceConversation.settings && typeof sourceConversation.settings === "object"
            ? sourceConversation.settings
            : undefined,
          pinned: false,
        }),
      });

      if (createRes.status === 401) {
        handleAuthExpired();
        return;
      }

      let createData = null;
      try {
        createData = await createRes.json();
      } catch {
        createData = null;
      }

      if (!createRes.ok) {
        throw new Error(createData?.error || "复制话题失败");
      }

      const duplicatedConversation = createData?.conversation;
      if (!duplicatedConversation?._id) {
        throw new Error("复制结果异常");
      }

      setCurrentConversationId(duplicatedConversation._id);
      setMessages(Array.isArray(duplicatedConversation.messages) ? duplicatedConversation.messages : []);

      const duplicatedModelId = resolveUsableModelId(duplicatedConversation.model, model);
      if (getModelConfig(duplicatedModelId)?.id) {
        setModel(duplicatedModelId);
        lastTextModelRef.current = duplicatedModelId;
      }

      applyConversationSettings(duplicatedConversation.settings);

      await fetchConversations();
      toast.success("已复制话题");
      if (window.innerWidth < 768) setSidebarOpen(false);
    } catch (error) {
      toast.error(error?.message || "复制话题失败");
    }
  };

  const updateThemeMode = (mode) => {
    setThemeMode(mode);
  };
  const updateFontSize = (size) => {
    setFontSize(size);
  };
  return (
    <>
      {showAuthModal ? (
        <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} loading={authLoading} />
      ) : (
        <ChatLayout
          user={user}
          isAdmin={!!user?.isAdmin}
          isSettingsReady={isSettingsReady}
          showProfileModal={showProfileModal}
          onCloseProfile={() => setShowProfileModal(false)}
          themeMode={themeMode}
          fontSize={fontSize}
          onThemeModeChange={updateThemeMode}
          onFontSizeChange={updateFontSize}
          completionSoundVolume={completionSoundVolume}
          onCompletionSoundVolumeChange={setCompletionSoundVolume}
          nickname={nickname}
          onNicknameChange={setNickname}
          onEmailChange={(updatedUser) => setUser((prev) => ({ ...prev, email: updatedUser.email }))}
          sidebarOpen={sidebarOpen}
          conversations={conversations}
          currentConversationId={currentConversationId}
          onStartNewChat={startNewChat}
          onLoadConversation={loadConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          onTogglePinConversation={togglePinConversation}
          onDuplicateConversation={duplicateConversation}
          onOpenProfile={() => setShowProfileModal(true)}
          onLogout={handleLogout}
          onCloseSidebar={() => setSidebarOpen(false)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          messages={messages}
          loading={loading}
          chatEndRef={chatEndRef}
          messageListRef={messageListRef}
          onMessageListScroll={handleMessageListScroll}
          showScrollButton={showScrollButton}
          onScrollToBottom={scrollToBottom}
          editingMsgIndex={editingMsgIndex}
          editingContent={editingContent}
          editingImageAction={editingImageAction}
          editingImage={editingImage}
          fontSizeClass={FONT_SIZE_CLASSES[fontSize]}
          onEditingContentChange={setEditingContent}
          onEditingImageSelect={actions.onEditingImageSelect}
          onEditingImageRemove={actions.onEditingImageRemove}
          onEditingImageKeep={actions.onEditingImageKeep}
          onCancelEdit={actions.cancelEdit}
          onSubmitEdit={actions.submitEditAndRegenerate}
          onCopy={actions.copyMessage}
          onDeleteModelMessage={actions.deleteModelMessage}
          onDeleteUserMessage={actions.deleteUserMessage}
          onRegenerateModelMessage={actions.regenerateModelMessage}
          onStartEdit={actions.startEdit}
          userAvatar={avatar}
          onAvatarChange={setAvatar}
          composerProps={{
            loading,
            isStreaming,
            isWaitingForAI: loading && messages.length > 0,
            model,
            modelReady: isSettingsReady,
            onModelChange: requestModelChange,
            onModeChange: requestModeChange,
            messages,
            historyLimit,
            webSearch,
            setWebSearch: (v) => {
              setWebSearch(v);
              syncConversationSettings({ webSearch: v });
            },
            chatSystemPrompt,
            onChatSystemPromptSave: setChatSystemPrompt,
            systemPrompts,
            addSystemPrompt,
            updateSystemPrompt,
            deleteSystemPrompt,
            onSend: actions.handleSendFromComposer,
            onStop: actions.stopStreaming,
            prefill: composerPrefill,
          }}
        />
      )}
      <ConfirmModal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={() => {
          confirmModalConfig?.onConfirm();
          setShowConfirmModal(false);
        }}
        title={confirmModalConfig?.title}
        message={confirmModalConfig?.message}
        confirmText="确定"
        cancelText="取消"
      />
    </>
  );
}
