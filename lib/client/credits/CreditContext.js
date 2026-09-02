"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJson } from "@/lib/client/apiClient";
import { CREDIT_SUMMARY_EVENT, normalizeCreditSummary } from "@/lib/client/credits/events";

const CREDIT_CHANNEL_NAME = "vectaix-credits";
const CreditContext = createContext(null);

export function CreditProvider({ children }) {
  const [credit, setCredit] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const channelRef = useRef(null);
  const requestRef = useRef(null);
  const creditRef = useRef(null);
  const accountRevisionRef = useRef(0);
  const hasCredit = credit !== null;

  const publish = useCallback((summary) => {
    channelRef.current?.postMessage({ type: "credit-summary", summary });
  }, []);

  const applyCreditSummary = useCallback((value, {
    broadcast = true,
    allowAccountSwitch = false,
  } = {}) => {
    const summary = normalizeCreditSummary(value?.credit || value);
    if (!summary) return null;
    const current = creditRef.current;
    if (!current && !allowAccountSwitch) return null;
    if (current?.userId && current.userId !== summary.userId && !allowAccountSwitch) {
      return current;
    }
    if (
      current?.userId === summary.userId
      && Number.isSafeInteger(current.version)
      && summary.version < current.version
    ) {
      return current;
    }
    if (allowAccountSwitch && current?.userId !== summary.userId) {
      accountRevisionRef.current += 1;
    }
    creditRef.current = summary;
    setCredit(summary);
    setRefreshFailed(false);
    if (broadcast && summary) publish(summary);
    return summary;
  }, [publish]);

  const clearCreditSummary = useCallback(() => {
    accountRevisionRef.current += 1;
    creditRef.current = null;
    setCredit(null);
    setPricing(null);
    setHistoryOpen(false);
    setRefreshFailed(false);
  }, []);

  const refreshCredit = useCallback(async () => {
    if (requestRef.current) return requestRef.current;
    const requestRevision = accountRevisionRef.current;
    const request = apiJson("/api/credits", { cache: "no-store" })
      .then((payload) => {
        if (requestRevision !== accountRevisionRef.current) return creditRef.current;
        setPricing(payload?.pricing && typeof payload.pricing === "object" ? payload.pricing : null);
        return applyCreditSummary(payload, { broadcast: false, allowAccountSwitch: true });
      })
      .catch((error) => {
        if (requestRevision !== accountRevisionRef.current) return creditRef.current;
        if (error?.status === 401) {
          clearCreditSummary();
          return null;
        }
        setRefreshFailed(true);
        throw error;
      })
      .finally(() => {
        requestRef.current = null;
        setLoading(false);
      });
    requestRef.current = request;
    return request;
  }, [applyCreditSummary, clearCreditSummary]);

  useEffect(() => {
    refreshCredit().catch(() => {});
  }, [refreshCredit]);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return undefined;
    const channel = new BroadcastChannel(CREDIT_CHANNEL_NAME);
    channelRef.current = channel;
    channel.addEventListener("message", (event) => {
      if (event?.data?.type !== "credit-summary") return;
      applyCreditSummary(event.data.summary, { broadcast: false });
    });
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [applyCreditSummary]);

  useEffect(() => {
    const handleFocus = () => refreshCredit().catch(() => {});
    const handleSummary = (event) => applyCreditSummary(event.detail);
    window.addEventListener("focus", handleFocus);
    window.addEventListener(CREDIT_SUMMARY_EVENT, handleSummary);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(CREDIT_SUMMARY_EVENT, handleSummary);
    };
  }, [applyCreditSummary, refreshCredit]);

  useEffect(() => {
    if (!hasCredit && !refreshFailed) return undefined;
    const timer = window.setInterval(() => {
      refreshCredit().catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [hasCredit, refreshCredit, refreshFailed]);

  const value = useMemo(() => ({
    credit,
    pricing,
    loading,
    historyOpen,
    applyCreditSummary,
    clearCreditSummary,
    refreshCredit,
    openCreditHistory: () => setHistoryOpen(true),
    closeCreditHistory: () => setHistoryOpen(false),
  }), [applyCreditSummary, clearCreditSummary, credit, historyOpen, loading, pricing, refreshCredit]);

  return <CreditContext.Provider value={value}>{children}</CreditContext.Provider>;
}

export function useCredits() {
  const context = useContext(CreditContext);
  if (!context) throw new Error("useCredits 必须在 CreditProvider 内使用");
  return context;
}
