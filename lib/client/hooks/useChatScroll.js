"use client";

import { useEffect, useRef, useState } from "react";

const SCROLL_BOTTOM_THRESHOLD = 80;

function distanceToBottom(el) {
  if (!el) return 0;
  const top = Number.isFinite(el.scrollTop) ? el.scrollTop : 0;
  const height = Number.isFinite(el.clientHeight) ? el.clientHeight : 0;
  const scrollHeight = Number.isFinite(el.scrollHeight) ? el.scrollHeight : 0;
  return Math.max(0, scrollHeight - (top + height));
}

export function useChatScroll({ messages, isStreaming }) {
  const [showScrollButton, setShowScrollButton] = useState(false);
  const chatEndRef = useRef(null);
  const messageListRef = useRef(null);
  const userInterruptedRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);
  const scrollRafRef = useRef(0);
  const isStreamingRef = useRef(false);

  isStreamingRef.current = isStreaming;

  const isNearBottom = (el) => distanceToBottom(el) <= SCROLL_BOTTOM_THRESHOLD;

  const scrollToBottom = () => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  };

  const scheduleScrollToBottom = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      scrollToBottom();
    });
  };

  const handleMessageListScroll = () => {
    const el = messageListRef.current;
    if (!el) return;

    setShowScrollButton(!isNearBottom(el));

    if (!isStreaming) return;

    const top = el.scrollTop;
    const last = lastScrollTopRef.current;
    lastScrollTopRef.current = top;
    if (isNearBottom(el)) {
      userInterruptedRef.current = false;
      return;
    }

    const recentUserGesture = Date.now() - lastUserScrollAtRef.current < 800;
    const moved = Math.abs(top - last) > 2;
    if (recentUserGesture && moved) {
      userInterruptedRef.current = true;
    }
  };

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
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
    scheduleScrollToBottom();
    if (!isStreaming) return;
    const timer = setTimeout(() => {
      if (userInterruptedRef.current) return;
      scrollToBottom();
    }, 60);
    return () => clearTimeout(timer);
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    let touchStartY = 0;
    let touchStartScrollTop = 0;

    const markUserGesture = () => {
      lastUserScrollAtRef.current = Date.now();
    };
    const handleTouchStart = (event) => {
      lastUserScrollAtRef.current = Date.now();
      touchStartY = event.touches?.[0]?.clientY;
      touchStartScrollTop = el.scrollTop;
    };
    const handleTouchMove = (event) => {
      lastUserScrollAtRef.current = Date.now();
      if (!isStreamingRef.current) return;
      const currentY = event.touches?.[0]?.clientY;
      const deltaY = currentY - touchStartY;
      if (deltaY > 10 || el.scrollTop < touchStartScrollTop - 5) {
        userInterruptedRef.current = true;
      }
    };
    const handleWheel = (event) => {
      lastUserScrollAtRef.current = Date.now();
      if (isStreamingRef.current && event.deltaY < 0) {
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
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!isStreamingRef.current) return;
      if (userInterruptedRef.current) return;
      scrollToBottom();
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return {
    chatEndRef,
    messageListRef,
    userInterruptedRef,
    isStreamingRef,
    showScrollButton,
    handleMessageListScroll,
    scrollToBottom,
  };
}
