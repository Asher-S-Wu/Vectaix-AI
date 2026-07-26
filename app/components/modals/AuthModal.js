"use client";

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
  onToggleMode,
  loading,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="auth-modal w-full max-w-sm rounded-3xl bg-white shadow-pop p-8 relative overflow-hidden">
        {/* 顶部品牌光晕 */}
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-48 bg-primary/15 blur-3xl rounded-full" />

        <div className="flex flex-col items-center mb-8 relative">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center shadow-soft">
            <BrandMark size={30} />
          </div>
          <span className="mt-3 text-[11px] font-bold tracking-[0.22em] text-zinc-400 uppercase">
            Vectaix AI
          </span>
        </div>
        <h2 className="text-xl font-semibold text-center mb-1 text-zinc-900 relative">
          {authMode === "login" ? "欢迎回来" : "创建账号"}
        </h2>
        <p className="text-center text-zinc-500 mb-8 text-sm relative">
          登录以继续使用 Vectaix AI
        </p>

        <form onSubmit={onSubmit} className="space-y-3 relative">
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="auth-input focus-ring w-full border border-zinc-200 rounded-xl p-3 text-zinc-900 placeholder-zinc-400 outline-none transition-all"
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className="auth-input focus-ring w-full border border-zinc-200 rounded-xl p-3 text-zinc-900 placeholder-zinc-400 outline-none transition-all"
            required
          />
          {authMode === "register" && (
            <input
              type="password"
              placeholder="确认密码"
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              className="auth-input focus-ring w-full border border-zinc-200 rounded-xl p-3 text-zinc-900 placeholder-zinc-400 outline-none transition-all"
              required
            />
          )}
          <button disabled={loading} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed font-medium py-3 rounded-xl flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? (authMode === "login" ? "登录中…" : "注册中…") : (authMode === "login" ? "登录" : "注册")}
          </button>

        </form>

        <p className="text-center mt-6 text-zinc-500 text-sm relative">
          {authMode === "login" ? "还没有账号？" : "已有账号？"}
          <button
            onClick={onToggleMode}
            className="text-primary hover:underline font-medium ml-1"
            type="button"
          >
            {authMode === "login" ? "立即注册" : "立即登录"}
          </button>
        </p>
      </div>
    </div>
  );
}
