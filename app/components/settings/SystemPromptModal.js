"use client";

import { useI18n } from '@/lib/client/i18n';
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, Trash2, Edit3, MessageSquareQuote, Check } from "lucide-react";
import { useToast } from "../common/ToastProvider";
import ConfirmModal from "../modals/ConfirmModal";
import { useClientReady } from "@/lib/client/hooks/useClientReady";

export default function SystemPromptModal({
  open,
  onClose,
  chatSystemPrompt,
  onChatSystemPromptSave,
  systemPrompts,
  addSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
}) {
  const { t } = useI18n();

  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useRef(null);
  const mounted = useClientReady();
  
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (deleteConfirmId) return;
      if (event.key === "Escape") { event.preventDefault(); if (!savingRef.current) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, deleteConfirmId, onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setDraft(chatSystemPrompt || "");
      setEditingId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [open, chatSystemPrompt]);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onChatSystemPromptSave(draft);
      toast.success(draft.trim() ? ["对话指令已生效", "Chat instructions saved"] : ["对话指令已清除", "Chat instructions cleared"]);
      onClose();
    } catch (e) {
      toast.error(e?.message || ["保存失败", "Could not save"]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleCreatePreset = () => {
    if (!draft.trim()) {
      toast.warning(["当前内容为空，请输入内容后再存为模板", "Add some instructions before saving a template."]);
      return;
    }
    setEditingId("new");
    setEditName(t("新模板", "New template"));
    setEditContent(draft);
  };

  const handleEditPreset = (e, preset) => {
    e.stopPropagation();
    setEditingId(preset._id);
    setEditName(preset.name);
    setEditContent(preset.content);
  };

  const submitPreset = async () => {
    if (savingRef.current) return;
    if (!editName.trim() || !editContent.trim()) {
      toast.warning(["名称和内容不能为空", "Enter a name and instructions."]);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (editingId === "new") {
        await addSystemPrompt(editName, editContent);
        toast.success(["已创建模板", "Template created"]);
      } else {
        await updateSystemPrompt(editingId, editName, editContent);
        toast.success(["已更新模板", "Template updated"]);
      }
      setEditingId(null);
    } catch (e) {
      toast.error(e?.message || ["保存失败", "Could not save"]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const applyPreset = (preset) => {
    setDraft(preset.content);
    toast.success(["已载入模板：{name}", "Loaded template: {name}", { name: preset.name }]);
  };

  const handleDeletePreset = (e, id) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmDeletePreset = async () => {
    if (savingRef.current) return;
    const id = deleteConfirmId;
    if (!id) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await deleteSystemPrompt(id);
      toast.success(["已删除模板", "Template deleted"]);
      if (editingId === id) setEditingId(null);
    } catch (e) {
      toast.error(e?.message || ["删除失败", "Could not delete"]);
    } finally {
      savingRef.current = false;
      setSaving(false);
      setDeleteConfirmId(null);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!savingRef.current && !deleteConfirmId) onClose(); }}
          role="dialog"
          aria-modal="true"
          aria-label={t('对话指令与模板', 'Chat instructions and templates')}
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ scale: 0.96, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 rounded-3xl shadow-pop w-full max-w-5xl flex flex-col md:flex-row overflow-hidden border border-zinc-200/50 dark:border-zinc-800/50 h-[85dvh] md:h-[80dvh] max-h-[800px]"
          >
            <div className="w-full md:w-72 lg:w-80 bg-zinc-50/80 dark:bg-zinc-900/50 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0 h-1/3 md:h-auto border-b md:border-b-0">
              <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center shrink-0">
                <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <MessageSquareQuote size={16} className="text-primary" />{t("指令模板", "Instruction templates")}</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 fade-scrollbar">
                {systemPrompts && systemPrompts.length > 0 ? (
                  systemPrompts.map((preset) => (
                    <div
                      key={preset._id}
                      className="group relative flex flex-col p-3.5 rounded-2xl border border-zinc-200/60 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/80 shadow-sm hover:border-primary/40 hover:shadow-md cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <button type="button" disabled={saving} aria-label={t('应用模板：{name}', 'Apply template: {name}', { name: preset.name })} onClick={() => applyPreset(preset)} className="absolute inset-0 rounded-2xl focus-ring" />
                      <div className="flex justify-between items-start mb-1.5">
                        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate pr-8">{preset.name}</h4>
                        <div className="preset-actions absolute z-10 right-2 top-2 flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                          <button disabled={saving} onClick={(e) => handleEditPreset(e, preset)} aria-label={t("编辑模板", "Edit template")} className="p-1.5 text-zinc-400 hover:text-primary bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-100 dark:border-zinc-700 transition-colors"><Edit3 size={14}/></button>
                          <button disabled={saving} onClick={(e) => handleDeletePreset(e, preset._id)} aria-label={t("删除模板", "Delete template")} className="p-1.5 text-zinc-400 hover:text-red-500 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-100 dark:border-zinc-700 ml-1 transition-colors"><Trash2 size={14}/></button>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">{preset.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
                    <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
                      <MessageSquareQuote size={20} className="text-zinc-400" />
                    </div>
                    <p className="text-sm text-zinc-500">{t("暂无模板", "No templates yet")}</p>
                    <p className="text-xs text-zinc-400 mt-1">{t("编辑内容后可存为模板", "Write instructions, then save them as a template.")}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 flex flex-col relative bg-white dark:bg-zinc-900 min-w-0">
              <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">{t("对话指令与模板", "Chat instructions and templates")}</h2>
                  <p className="text-xs text-zinc-500 mt-1">{t("保存常用工作要求，随时选择适合当前工作的模板。", "Save instructions you use often and choose a template for your current task.")}</p>
                </div>
                <button disabled={saving} onClick={() => { if (!savingRef.current) onClose(); }} aria-label={t("关闭", "Close")} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="min-h-0 flex-1 p-6 flex flex-col gap-4 overflow-y-auto fade-scrollbar">
                {editingId ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {editingId === "new" ? t("新建模板", "Create template") : t("编辑模板", "Edit template")}
                      </h3>
                    </div>
                    <input
                      type="text"
                      aria-label={t("模板名称", "Template name")}
                      maxLength={50}
                      disabled={saving}
                      placeholder={t("模板名称，例如：前端专家", "Template name, such as Frontend expert")}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-4 transition-all"
                    />
                    <textarea
                      disabled={saving}
                      maxLength={10000}
                      aria-label={t("模板指令", "Template instructions")}
                      className="flex-1 w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all leading-relaxed fade-scrollbar"
                      placeholder={t("输入模板中的对话指令…", "Enter instructions for this template…")}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                    />
                    <div className="flex justify-end gap-3 mt-4 shrink-0">
                      <button disabled={saving} onClick={() => setEditingId(null)} className="px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">{t("取消", "Cancel")}</button>
                      <button disabled={saving} onClick={submitPreset} className="btn-primary px-6 py-2.5 text-sm font-medium rounded-xl flex items-center gap-2">
                        <Check size={16} />{t("保存模板", "Save template")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-3 shrink-0">
                      <label className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t("后续对话使用的指令", "Instructions for future chats")}</label>
                      <button disabled={saving} onClick={handleCreatePreset} className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
                        <Plus size={14} />{t("存为新模板", "Save as new template")}</button>
                    </div>
                    <textarea
                      disabled={saving}
                      maxLength={10000}
                      aria-label={t("后续对话使用的指令", "Instructions for future chats")}
                      className="flex-1 w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-5 text-[15px] text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all leading-relaxed shadow-inner fade-scrollbar"
                      placeholder={t("填写你希望助手遵守的工作要求，例如语言、格式和表达习惯。", "Describe how you want the assistant to work, including language, format, and writing style.")}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                    />
                  </div>
                )}
              </div>
              
              {!editingId && (
                <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-center shrink-0">
                  <div className="text-xs text-zinc-500">{t("保存后将用于后续对话", "Saved instructions apply to future chats")}</div>
                  <div className="flex items-center gap-3">
                    <button disabled={saving} onClick={() => { if (!savingRef.current) onClose(); }} className="px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">{t("取消", "Cancel")}</button>
                    <button disabled={saving} onClick={handleSave} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-50 rounded-xl flex items-center gap-2">
                      <Check size={16} />
                      {saving ? t("保存中…", "Saving…") : t("保存指令", "Save instructions")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      <ConfirmModal
        open={Boolean(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDeletePreset}
        title={t("删除模板", "Delete template")}
        message={t("确定要删除这个模板吗？此操作无法撤销。", "Delete this template? This action is permanent.")}
        confirmText={t("删除", "Delete")}
        danger
      />
    </>,
    document.body
  );
}
