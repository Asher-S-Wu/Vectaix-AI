"use client";

import { useI18n } from '@/lib/client/i18n';
import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import BrandMark from "../common/BrandMark";

export default function AuthModal({
  authMode,
  email,
  password,
  confirmPassword,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onPasskey,
  onToggleMode,
  loading,
}) {
  const { t, locale, setLocale } = useI18n();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-app-secondary p-4"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="auth-modal my-auto w-full max-w-md shrink-0 rounded-3xl bg-white border border-zinc-200 p-6 sm:p-10 relative"
      >

        <div role="group" aria-label={t("界面语言", "Interface language")} className="mb-4 flex justify-end gap-1 text-xs">{[{ id: "zh", label: "中文" }, { id: "en", label: "English" }].map(option => <button key={option.id} type="button" onClick={() => setLocale(option.id)} aria-pressed={locale === option.id} lang={option.id === "zh" ? "zh-CN" : "en"} className={`rounded-lg px-2.5 py-1.5 transition-colors ${locale === option.id ? "bg-primary/10 text-primary" : "text-zinc-500 hover:bg-zinc-100"}`}>{option.label}</button>)}</div>
        <div className="flex flex-col items-center mb-6">
          <motion.div
            initial={reduceMotion ? false : { y: 8, rotate: -6, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", damping: 12, stiffness: 180, delay: 0.1 }}
          >
            <BrandMark size={84} />
          </motion.div>
        </div>
        <h1 className="text-xl font-semibold text-center mb-1.5 text-zinc-900">
          {authMode === "login" ? t("登录花卷", "Sign in to Huajuan") : t("创建花卷账号", "Create a Huajuan account")}
        </h1>
        <p className="text-center text-zinc-500 mb-7 text-sm">
          {authMode === "login" ? t("继续处理你的任务和对话", "Continue your tasks and conversations") : t("输入邮箱和密码创建账号", "Enter your email and password to create an account")}
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            aria-label={t("邮箱", "Email")}
            autoComplete="email"
            placeholder={t("邮箱", "Email")}
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="auth-input focus-ring w-full border border-zinc-200 rounded-xl p-3 text-zinc-900 placeholder-zinc-400 outline-none transition-all"
            required
            autoFocus
          />
          <input
            type="password"
            aria-label={t("密码", "Password")}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            placeholder={t("密码", "Password")}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className="auth-input focus-ring w-full border border-zinc-200 rounded-xl p-3 text-zinc-900 placeholder-zinc-400 outline-none transition-all"
            required
          />
          {authMode === "register" && (
            <motion.input
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              type="password"
              aria-label={t("确认密码", "Confirm password")}
              autoComplete="new-password"
              placeholder={t("确认密码", "Confirm password")}
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              className="auth-input focus-ring w-full border border-zinc-200 rounded-xl p-3 text-zinc-900 placeholder-zinc-400 outline-none transition-all"
              required
            />
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed font-medium py-3 rounded-xl flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />}
            {loading ? (authMode === "login" ? t("登录中…", "Signing in…") : t("注册中…", "Creating account…")) : (authMode === "login" ? t("登录", "Sign in") : t("注册", "Create account"))}
          </button>

        </form>
        {authMode === "login" && <button type="button" disabled={loading} onClick={onPasskey} className="mt-3 w-full rounded-xl border border-zinc-200 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-primary/40 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed">{t("使用通行密钥登录", "Sign in with a passkey")}</button>}

        <p className="text-center mt-6 text-zinc-500 text-sm">
          {authMode === "login" ? t("还没有账号？", "New to Huajuan?") : t("已有账号？", "Already have an account?")}
          <button
            onClick={onToggleMode}
            className="text-primary hover:underline font-medium ml-1"
            type="button"
          >
            {authMode === "login" ? t("立即注册", "Create an account") : t("立即登录", "Sign in")}
          </button>
        </p>
      </motion.div>
    </motion.div>
  );
}
