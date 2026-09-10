"use client";



import { startAuthentication } from "@simplewebauthn/browser";
import { apiJson } from "@/lib/client/apiClient";
import { useEffect, useEffectEvent, useState } from "react";


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

  const handlePasskeyAuth = async () => {
    if (authLoading) return;
    if (!window.PublicKeyCredential) { toast.error('当前浏览器不支持通行密钥'); return; }
    setAuthLoading(true);
    try {
      const options = await apiJson('/api/auth/passkeys', {method:'POST',body:{action:'authentication-options'}});
      const response = await startAuthentication({optionsJSON:options.options});
      const data = await apiJson('/api/auth/passkeys', {method:'POST',body:{action:'authentication-verify',challengeId:options.challengeId,response}});
      activateUserSession(data.user,'登录成功');
    } catch(error) { toast.error(error.name === 'NotAllowedError' || error.cause?.name === 'NotAllowedError' ? '通行密钥验证已取消' : error.name === 'WebAuthnError' ? '设备验证未完成，请检查通行密钥授权' : error.message); }
    finally { setAuthLoading(false); }
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

  const initializeSession = useEffectEvent(() => {
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
  });

  useEffect(() => {
    initializeSession();
  }, []);

  return {
    user,
    setUser,
    showAuthModal,
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
    handlePasskeyAuth,
    handleLogout,
    handleAuthExpired,
  };
}
