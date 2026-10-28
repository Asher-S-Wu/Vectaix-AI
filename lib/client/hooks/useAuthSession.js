"use client";



import { startAuthentication } from "@simplewebauthn/browser";
import { apiJson } from "@/lib/client/apiClient";
import { useEffect, useEffectEvent, useRef, useState } from "react";


export function useAuthSession({
  initialUser = null,
  toast,
  stopOngoingChatWork,
  fetchConversations,
  fetchSettings,
  onAuthenticated,
  onAuthExpired,
}) {
  const [user, setUser] = useState(initialUser);
  const [showAuthModal, setShowAuthModal] = useState(!initialUser);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const sessionRequestRef = useRef(null);
  const [serverUser, setServerUser] = useState(initialUser);
  if (serverUser !== initialUser) {
    setServerUser(initialUser);
    if (initialUser && user?.id === initialUser.id) setUser(initialUser);
  }

  const resetSensitiveFields = () => {
    setPassword("");
    setConfirmPassword("");
  };

  const handleAuthExpired = () => {
    sessionRequestRef.current?.abort();
    stopOngoingChatWork();
    setUser(null);
    setShowAuthModal(true);
    setAuthMode("login");
    resetSensitiveFields();
    onAuthExpired?.();
  };

  const activateUserSession = (nextUser, successMessage) => {
    sessionRequestRef.current?.abort();
    stopOngoingChatWork();
    setUser(nextUser);
    setShowAuthModal(false);
    setAuthMode("login");
    resetSensitiveFields();
    if (successMessage) toast.success(successMessage);
    onAuthenticated?.();
    fetchConversations();
    fetchSettings();
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
      const data = await apiJson(endpoint, { method: "POST", body });
      activateUserSession(data.user, authMode === "login" ? ['登录成功', 'Signed in'] : ['注册成功', 'Account created']);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasskeyAuth = async () => {
    if (authLoading) return;
    if (!window.PublicKeyCredential) { toast.error(['当前浏览器不支持通行密钥', 'This browser does not support passkeys.']); return; }
    setAuthLoading(true);
    try {
      const options = await apiJson('/api/auth/passkeys', {method:'POST',body:{action:'authentication-options'}});
      const response = await startAuthentication({optionsJSON:options.options});
      const data = await apiJson('/api/auth/passkeys', {method:'POST',body:{action:'authentication-verify',challengeId:options.challengeId,response}});
      activateUserSession(data.user,['登录成功', 'Signed in']);
    } catch(error) { toast.error(error.name === 'NotAllowedError' || error.cause?.name === 'NotAllowedError' ? ['通行密钥验证已取消', 'Passkey verification canceled.'] : error.name === 'WebAuthnError' ? ['设备验证未完成，请检查通行密钥授权', 'Device verification was not completed. Check passkey permissions.'] : error.message); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = async () => {
    try {
      await apiJson("/api/auth/me", { method: "DELETE" });
      setEmail("");
      handleAuthExpired();
    } catch (error) {
      toast.error(["退出失败：{error}", "Sign-out failed: {error}", { error: error.message }]);
    }
  };

  const initializeSession = useEffectEvent(() => {
    const controller = new AbortController();
    sessionRequestRef.current = controller;
    fetch("/api/auth/me", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.user) {
          activateUserSession(data.user);
          return;
        }
        handleAuthExpired();
      })
      .catch(() => {
        if (!controller.signal.aborted) handleAuthExpired();
      });
  });

  useEffect(() => {
    initializeSession();
    return () => sessionRequestRef.current?.abort();
  }, []);

  return {
    user,
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
