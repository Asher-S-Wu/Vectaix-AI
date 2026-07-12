"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import NextImage from "next/image";
import {
  ChevronDown,
  Lock,
  Settings,
  Palette,
  Type,
  Users,
  X,
  Camera,
  Volume2,
  User,
  Mail,
} from "lucide-react";

import { deleteTemporaryFile, uploadPrivateFile } from "@/lib/client/uploadFile";
import { apiJson } from "@/lib/client/apiClient";
import { useToast } from "../common/ToastProvider";
import UserManagementModal from "./UserManagementModal";

export default function ProfileModal({
  open,
  onClose,
  user,
  isAdmin,
  themeMode,
  fontSize,
  onThemeModeChange,
  onFontSizeChange,
  completionSoundVolume,
  onCompletionSoundVolumeChange,
  avatar,
  onAvatarChange,
  nickname,
  onNicknameChange,
  onEmailChange,
}) {
  const toast = useToast();
  const [showPersonalInfo, setShowPersonalInfo] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [avatarLoading, setAvatarLoading] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameSaving, setNicknameSaving] = useState(false);

  const [emailDraft, setEmailDraft] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const normalizedVolume = Number.isFinite(Number(completionSoundVolume))
    ? Number(completionSoundVolume)
    : 60;

  const emailInitial = useMemo(() => {
    const c = user?.email?.[0];
    return c ? c.toUpperCase() : "?";
  }, [user?.email]);

  const avatarFileInputRef = useRef(null);
  const canManageUsers = Boolean(isAdmin);
  const savedNickname = typeof nickname === "string" ? nickname : "";
  const hasNicknameChanges = nicknameDraft !== savedNickname;

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.warning("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.warning("图片大小不能超过 5MB");
      return;
    }

    setAvatarLoading(true);
    let uploadedFileId = null;
    try {
      const uploaded = await uploadPrivateFile(file, { kind: "avatar" });
      uploadedFileId = uploaded.fileId;
      const saved = await onAvatarChange?.(uploaded.fileId);
      if (!saved) {
        await deleteTemporaryFile(uploaded.fileId);
        uploadedFileId = null;
        throw new Error("头像保存失败");
      }
      uploadedFileId = null;
      toast.success("头像更新成功");
    } catch (err) {
      if (uploadedFileId) await deleteTemporaryFile(uploadedFileId);
      toast.error(err?.message);
    } finally {
      setAvatarLoading(false);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setNicknameDraft(savedNickname);
      setEmailDraft(user?.email || "");
      setEmailPassword("");
    }, 0);
    return () => clearTimeout(timer);
  }, [open, savedNickname, user?.email]);

  const saveNickname = async () => {
    if (!hasNicknameChanges || !onNicknameChange) return;
    setNicknameSaving(true);
    try {
      const settings = await onNicknameChange(nicknameDraft);
      if (!settings) return;
      toast.success("昵称已更新");
    } finally {
      setNicknameSaving(false);
    }
  };

  const currentEmail = user?.email || "";
  const hasEmailChanges = emailDraft.trim().toLowerCase() !== currentEmail;

  const saveEmail = async () => {
    if (!hasEmailChanges) return;
    if (!emailPassword) {
      toast.warning("请输入当前密码以验证身份");
      return;
    }
    setEmailSaving(true);
    try {
      const data = await apiJson("/api/auth/change-email", {
        method: "POST",
        body: { newEmail: emailDraft.trim(), password: emailPassword },
      });
      if (data.success) {
        toast.success("邮箱已更新");
        setEmailPassword("");
        onEmailChange?.(data.user);
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error(err?.message || "修改邮箱失败");
    } finally {
      setEmailSaving(false);
    }
  };

  const submitChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      toast.warning("两次输入的新密码不一致");
      return;
    }

    setPwLoading(true);
    try {
      const data = await apiJson("/api/auth/change-password", {
        method: "POST",
        body: { oldPassword, newPassword, confirmNewPassword },
      });
      if (data.success) {
        toast.success("密码修改成功");
        setOldPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error(err?.message || "密码修改失败");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 p-6 md:p-8 rounded-2xl w-full max-w-md shadow-xl border border-zinc-200 dark:border-zinc-700 relative"
              onClick={(e) => e.stopPropagation()}
            >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-6">
              <input
                type="file"
                ref={avatarFileInputRef}
                onChange={handleAvatarSelect}
                className="hidden"
                accept="image/*"
              />
              <button
                type="button"
                onClick={() => avatarFileInputRef.current?.click()}
                disabled={avatarLoading}
                className="relative w-16 h-16 rounded-xl mx-auto flex items-center justify-center mb-3 overflow-hidden group transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                title="点击更换头像"
              >
                {avatar ? (
                  <NextImage src={avatar} alt="" fill sizes="64px" unoptimized className="object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-500 flex items-center justify-center text-xl font-semibold text-white">
                    {emailInitial}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={20} className="text-white" />
                </div>
                {avatarLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </button>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {savedNickname || currentEmail}
              </p>
              <p className="text-sm text-zinc-500 mt-1">个人中心</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setShowPersonalInfo(!showPersonalInfo)}
                className="w-full flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <User size={14} /> 个人信息
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showPersonalInfo ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {showPersonalInfo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700 space-y-4">
                      <div>
                        <label className="text-xs text-zinc-500 font-medium mb-1.5 block">昵称</label>
                        <input
                          type="text"
                          placeholder="输入昵称"
                          value={nicknameDraft}
                          onChange={(e) => setNicknameDraft(e.target.value)}
                          className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
                        />
                        {hasNicknameChanges && (
                          <button
                            type="button"
                            onClick={saveNickname}
                            disabled={nicknameSaving}
                            className="mt-2 w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-xs transition-colors"
                          >
                            {nicknameSaving ? "保存中..." : "保存昵称"}
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 font-medium mb-1.5 block flex items-center gap-1">
                          <Mail size={11} /> 邮箱
                        </label>
                        <input
                          type="email"
                          placeholder="输入新邮箱"
                          value={emailDraft}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
                        />
                        {hasEmailChanges && (
                          <div className="mt-2 space-y-2">
                            <input
                              type="password"
                              placeholder="输入当前密码以验证身份"
                              value={emailPassword}
                              onChange={(e) => setEmailPassword(e.target.value)}
                              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
                            />
                            <button
                              type="button"
                              onClick={saveEmail}
                              disabled={emailSaving}
                              className="w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-xs transition-colors"
                            >
                              {emailSaving ? "保存中..." : "保存邮箱"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <button
                onClick={() => setShowChangePassword(!showChangePassword)}
                className="w-full flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <Lock size={14} /> 修改密码
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showChangePassword ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showChangePassword && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700">
                      <form onSubmit={submitChangePassword} className="space-y-3">
                        <input
                          type="password"
                          placeholder="当前密码"
                          value={oldPassword}
                          onChange={(e) => setOldPassword(e.target.value)}
                          className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
                          required
                        />
                        <input
                          type="password"
                          placeholder="新密码"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
                          required
                        />
                        <input
                          type="password"
                          placeholder="确认新密码"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-zinc-400 outline-none"
                          required
                        />
                        <button
                          type="submit"
                          disabled={pwLoading}
                          className="w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                        >
                          更新密码
                        </button>
                      </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <button
                onClick={() => setShowAppearance(!showAppearance)}
                className="w-full flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <Settings size={14} /> 系统设置
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showAppearance ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showAppearance && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700 space-y-4">
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Palette size={12} /> 主题模式
                        </label>
                        <div className="flex gap-2">
                          {[
                            { id: "light", label: "浅色" },
                            { id: "dark", label: "深色" },
                            { id: "system", label: "跟随系统" },
                          ].map((t) => (
                            <button
                              key={t.id}
                              onClick={() => onThemeModeChange(t.id)}
                              type="button"
                              className={`flex-1 py-2 rounded-lg border transition-colors text-sm ${themeMode === t.id
                                ? "bg-zinc-600 text-white border-zinc-600"
                                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Type size={12} /> 字体大小
                        </label>
                        <div className="flex gap-2">
                          {[
                            { id: "small", label: "小", size: "text-xs" },
                            { id: "medium", label: "中", size: "text-sm" },
                            { id: "large", label: "大", size: "text-base" },
                          ].map((f) => (
                            <button
                              key={f.id}
                              onClick={() => onFontSizeChange(f.id)}
                              type="button"
                              className={`flex-1 py-2 rounded-lg border transition-colors ${fontSize === f.id
                                ? "bg-zinc-600 text-white border-zinc-600"
                                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                } ${f.size}`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Volume2 size={12} /> 提示音音量
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={normalizedVolume}
                            onChange={(e) => onCompletionSoundVolumeChange?.(Number(e.target.value))}
                            className="w-full"
                          />
                          <span className="text-xs text-zinc-500 w-12 text-right">
                            {normalizedVolume <= 0 ? "关闭" : `${normalizedVolume}%`}
                          </span>
                         </div>
                      </div>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {canManageUsers && (
                <button
                  onClick={() => setShowUserManagement(true)}
                  className="w-full flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl p-4 border border-zinc-100 dark:border-zinc-700 transition-colors"
                >
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                    <Users size={14} /> 用户管理
                  </span>
                  <ChevronDown size={16} className="text-zinc-400" />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <UserManagementModal
      open={showUserManagement}
      onClose={() => setShowUserManagement(false)}
    />
  </>
  );
}
