"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, Trash2, Edit3, MessageSquareQuote, Check } from "lucide-react";
import { useToast } from "../common/ToastProvider";
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
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const mounted = useClientReady();
  
  // Inline edit state for preset
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setDraft(chatSystemPrompt || "");
      setEditingId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [open, chatSystemPrompt]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onChatSystemPromptSave(draft);
      toast.success(draft.trim() ? "系统提示词已生效" : "系统提示词已清除");
      onClose();
    } catch (e) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePreset = () => {
    if (!draft.trim()) {
      toast.warning("当前内容为空，请输入内容后再存为预设");
      return;
    }
    setEditingId("new");
    setEditName("新预设");
    setEditContent(draft);
  };

  const handleEditPreset = (e, preset) => {
    e.stopPropagation();
    setEditingId(preset._id);
    setEditName(preset.name);
    setEditContent(preset.content);
  };

  const submitPreset = async () => {
    if (!editName.trim() || !editContent.trim()) {
      toast.warning("名称和内容不能为空");
      return;
    }
    try {
      if (editingId === "new") {
        await addSystemPrompt(editName, editContent);
        toast.success("已创建预设");
      } else {
        await updateSystemPrompt(editingId, editName, editContent);
        toast.success("已更新预设");
      }
      setEditingId(null);
    } catch (e) {
      toast.error(e?.message || "保存失败");
    }
  };

  const applyPreset = (preset) => {
    setDraft(preset.content);
    toast.success(`已应用预设：${preset.name}`);
  };

  const handleDeletePreset = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("确定删除此预设吗？")) return;
    try {
      await deleteSystemPrompt(id);
      toast.success("已删除预设");
      if (editingId === id) setEditingId(null);
    } catch (e) {
      toast.error("删除失败");
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 rounded-3xl shadow-pop w-full max-w-5xl flex flex-col md:flex-row overflow-hidden border border-zinc-200/50 dark:border-zinc-800/50 h-[85dvh] md:h-[80vh] min-h-[400px] md:min-h-[500px] max-h-[800px]"
          >
            {/* Left Panel: Presets */}
            <div className="w-full md:w-72 lg:w-80 bg-zinc-50/80 dark:bg-zinc-900/50 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0 h-1/3 md:h-auto border-b md:border-b-0">
              <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center shrink-0">
                <h3 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <MessageSquareQuote size={16} className="text-primary" />
                  预设库
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 fade-scrollbar">
                {systemPrompts && systemPrompts.length > 0 ? (
                  systemPrompts.map((preset) => (
                    <div
                      key={preset._id}
                      onClick={() => applyPreset(preset)}
                      className="group relative flex flex-col p-3.5 rounded-2xl border border-zinc-200/60 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/80 shadow-sm hover:border-primary/40 hover:shadow-md cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate pr-8">{preset.name}</h4>
                        <div className="absolute right-2 top-2 flex opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => handleEditPreset(e, preset)} className="p-1.5 text-zinc-400 hover:text-blue-500 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-100 dark:border-zinc-700 transition-colors"><Edit3 size={14}/></button>
                          <button onClick={(e) => handleDeletePreset(e, preset._id)} className="p-1.5 text-zinc-400 hover:text-red-500 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-100 dark:border-zinc-700 ml-1 transition-colors"><Trash2 size={14}/></button>
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
                    <p className="text-sm text-zinc-500">暂无预设</p>
                    <p className="text-xs text-zinc-400 mt-1">在右侧编辑内容后可存为预设</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Editor */}
            <div className="flex-1 flex flex-col relative bg-white dark:bg-zinc-900 min-w-0">
              {/* Header */}
              <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">系统提示词配置</h2>
                  <p className="text-xs text-zinc-500 mt-1">控制大模型的默认行为、背景设定和回复风格。仅在 Chat 模式下生效。</p>
                </div>
                <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              {/* Body */}
              <div className="flex-1 p-6 flex flex-col gap-4 overflow-y-auto fade-scrollbar">
                {editingId ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {editingId === "new" ? "新建预设" : "编辑预设"}
                      </h3>
                    </div>
                    <input
                      type="text"
                      placeholder="预设名称，例如：前端专家"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5 text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-4 transition-all"
                    />
                    <textarea
                      className="flex-1 w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-sm text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all leading-relaxed fade-scrollbar"
                      placeholder="输入预设的提示词内容…"
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                    />
                    <div className="flex justify-end gap-3 mt-4 shrink-0">
                      <button onClick={() => setEditingId(null)} className="px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                        取消
                      </button>
                      <button onClick={submitPreset} className="px-6 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-2">
                        <Check size={16} />
                        保存预设
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-3 shrink-0">
                      <label className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        当前会话生效内容
                      </label>
                      <button onClick={handleCreatePreset} className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
                        <Plus size={14} /> 存为新预设
                      </button>
                    </div>
                    <textarea
                      className="flex-1 w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-5 text-[15px] text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all leading-relaxed shadow-inner fade-scrollbar"
                      placeholder="默认无。在这里输入的内容，将会在每次发送消息时，追加到大模型的系统提示词最后。"
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                    />
                  </div>
                )}
              </div>
              
              {/* Footer */}
              {!editingId && (
                <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-center shrink-0">
                  <div className="text-xs text-zinc-500">
                    配置保存后立即对后续对话生效
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                      取消
                    </button>
                    <button disabled={saving} onClick={handleSave} className="px-6 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-2">
                      <Check size={16} />
                      {saving ? "保存中…" : "应用配置"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
