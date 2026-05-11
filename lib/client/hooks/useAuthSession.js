"use client";

import { useEffect, useState } from "react";

export function useAuthSession({
  toast,
  stopOngoingChatWork,
  fetchConversations,
  fetchSettings,
  onAuthenticated,
  onAuthExpired,
}) {
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const resetSensitiveFields = () => {
    setPassword("");
    setConfirmPassword("");
  };

  const handleAuthExpired = () => {
    stopOngoingChatWork();
    setUser(null);
    setShowAuthModal(true);
    setAuthMode("login");
    resetSensitiveFields();
    onAuthExpired?.();
  };

  const activateUserSession = (nextUser, successMessage) => {
    stopOngoingChatWork();
    setUser(nextUser);
    setShowAuthModal(false);
    setAuthMode("login");
    resetSensitiveFields();
    toast.success(successMessage);
    onAuthenticated?.();
    fetchConversations();
    Promise.resolve(fetchSettings()).finally(() => {
      onAuthenticated?.({ settingsReady: true });
    });
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    if (authLoading) return;
    setAuthLoading(true);

    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = authMode === "login"
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
        activateUserSession(data.user, authMode === "login" ? "登录成功" : "注册成功");
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
    setUser(null);
    setEmail("");
    resetSensitiveFields();
    setShowAuthModal(true);
    onAuthExpired?.({ logout: true });
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          fetchConversations();
          Promise.resolve(fetchSettings()).finally(() => {
            onAuthenticated?.({ settingsReady: true });
          });
          return;
        }
        handleAuthExpired();
      })
      .catch(() => {
        handleAuthExpired();
      });
  }, []);

  return {
    user,
    setUser,
    showAuthModal,
    setShowAuthModal,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    authLoading,
    handleAuth,
    handleLogout,
    handleAuthExpired,
  };
}
