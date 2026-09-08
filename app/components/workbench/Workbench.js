"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUp, ArrowUpRight, BookOpen, Brain, Check, ChevronRight, Circle, FileText, Folder, FolderPlus, Layers, Loader2, Menu, MessageSquare, PanelRight, Pencil, Plus, Search, Settings2, Sparkles, Square, Trash2, Upload, X, Download } from "lucide-react";
import Markdown from "@/app/components/common/Markdown";
import ModeSwitcher from "@/app/components/layout/ModeSwitcher";
import CreditShell from "@/app/components/credits/CreditShell";
import { apiJson, apiRequest } from "@/lib/client/apiClient";
import { getSelectableChatModels, DEFAULT_MODEL } from "@/lib/shared/models";
import { IMAGE_SIZE_OPTIONS, VIDEO_ASPECT_RATIO_OPTIONS, VIDEO_DURATION_OPTIONS, VIDEO_RESOLUTION_OPTIONS, VIDEO_MODE_OPTIONS } from "@/lib/media/shared/models";
import { MINIMAX_AUDIO_MODELS, MINIMAX_AUDIO_EMOTION_OPTIONS, MINIMAX_AUDIO_LANGUAGE_OPTIONS, MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS } from "@/lib/media/shared/minimaxAudio";
const CHAT_MODELS = getSelectableChatModels();
import styles from "./Workbench.module.css";

const ACTIVE = new Set(["queued", "running", "waiting_media"]);
const STATUS = { queued: "排队中", running: "正在处理", waiting_media: "正在生成媒体", completed: "已完成", failed: "执行失败", stopped: "已停止", interrupted: "已中断" };
const STARTERS = [
  { icon: Search, title: "研究一个主题", text: "围绕这个项目开展研究，列出关键发现、依据和需要进一步确认的问题。" },
  { icon: FileText, title: "整理项目资料", text: "阅读项目资料，提炼核心信息，并整理成一份结构清晰的文档。" },
  { icon: Sparkles, title: "把想法变成作品", text: "根据这个项目的目标，帮我制定创作方案，并完成一份可交付的作品。" },
];
function IconButton({ title, children, ...props }) { return <button type="button" title={title} aria-label={title} className={styles.iconButton} {...props}>{children}</button>; }
function Toggle({ checked, onChange, label, disabled }) { return <label className={styles.toggle}><span>{label}</span><input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} /><span className={styles.switch} /></label>; }
function Empty({ icon: Icon, children }) { return <div className={styles.emptySmall}><Icon size={25} strokeWidth={1.3} /><p>{children}</p></div>; }
function Editor({ editor, close, save, busy, error }) {
  const ref = useRef(null);
  const [formValues, setFormValues] = useState(() => Object.fromEntries((editor.fields || []).map(field => [field.name, field.value])));
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={styles.dialog} onCancel={close} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={save} onChange={event => { if (event.target.name) setFormValues(values => ({ ...values, [event.target.name]: event.target.value })); }}>
      <div className={styles.dialogHeader}><h2>{editor.title}</h2><IconButton title="关闭" onClick={close}><X size={20} /></IconButton></div>
      {editor.kind === "delete" ? <p className={styles.deleteNotice}>{editor.message}</p> : editor.fields.filter(field => !field.when || field.when(formValues)).map(field => <label className={styles.field} key={field.name}><span>{field.label}</span>{field.type === "select" ? <select name={field.name} defaultValue={field.value}>{(typeof field.options === "function" ? field.options(formValues) : field.options).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.multiline ? <textarea name={field.name} rows={field.rows || 5} defaultValue={field.value} required={field.required || field.type === "number"} maxLength={field.maxLength} /> : <input name={field.name} type={field.type || "text"} step={field.step} min={field.min} max={field.max} defaultValue={field.value} required={field.required || field.type === "number"} maxLength={field.maxLength} />}{field.hint && <small>{field.hint}</small>}</label>)}
      {error && <p className={styles.taskError} role="alert">{error}</p>}
      <div className={styles.dialogFooter}><button type="button" className={styles.secondary} onClick={close}>取消</button><button disabled={busy} className={editor.kind === "delete" ? styles.danger : styles.primary}>{busy ? "处理中…" : editor.kind === "delete" ? "确认删除" : "保存"}</button></div>
    </form>
  </dialog>;
}

export default function Workbench() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [tasks, setTasks] = useState([]);
  const [task, setTask] = useState(null);
  const [events, setEvents] = useState([]);
  const [files, setFiles] = useState([]);
  const [skills, setSkills] = useState([]);
  const [memories, setMemories] = useState([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [panel, setPanel] = useState("files");
  const [drawer, setDrawer] = useState(null);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [mediaSettings, setMediaSettings] = useState({});
  const [continuing, setContinuing] = useState(false);
  const [filter, setFilter] = useState("");
  const [limits, setLimits] = useState(null);
  const projectRef = useRef(projectId);
  const taskRef = useRef(null);
  const uploadRef = useRef(null);
  const skillRef = useRef(null);
  const promptRef = useRef(null);
  const project = projects.find(item => item._id === projectId);
  const reportError = (failure) => { setError(failure.message); if (failure.status === 401) setNeedsLogin(true); };
  const run = async (action) => { if (busy) return; setBusy(true); setError(""); try { await action(); } catch (failure) { reportError(failure); } finally { setBusy(false); } };
  const pickTask = (next) => { taskRef.current = next?._id; setTask(next); setEvents([]); setConversation(null); setContinuing(false); setDrawer(null); };
  const pickProject = (id) => { if (id === projectRef.current) { setDrawer(null); return; } projectRef.current = id; setProjectLoading(Boolean(id)); setTasks([]); setFiles([]); setMemories([]); setConversations([]); setProjectId(id); pickTask(null); setDrawer(null); setPrompt(""); };

  useEffect(() => {
    let disposed = false;
    Promise.all([apiJson("/api/projects"), apiJson("/api/skills"), apiJson("/api/memories/settings")]).then(([p, s, m]) => {
      if (disposed) return;
      setProjects(p.projects); setSkills(s.skills); setMemoryEnabled(m.enabled);
      if (p.projects.length) { setProjectLoading(true); projectRef.current = p.projects[0]._id; setProjectId(p.projects[0]._id); }
    }).catch(failure => { if (!disposed) reportError(failure); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!projectId) {
      apiJson("/api/memories").then(result => { if (!disposed) setMemories(result.memories); }).catch(failure => { if (!disposed) reportError(failure); });
      return () => { disposed = true; };
    }
    Promise.all([apiJson(`/api/tasks?projectId=${projectId}`), apiJson(`/api/projects/${projectId}/files`), apiJson(`/api/memories?projectId=${projectId}`), apiJson(`/api/conversations?projectId=${projectId}`)]).then(([t, f, m, c]) => {
      if (disposed) return;
      setTasks(t.tasks); setLimits(t.limits); setFiles(f.files); setMemories(m.memories); setConversations(c.conversations);
    }).catch(failure => { if (!disposed) reportError(failure); }).finally(() => { if (!disposed) setProjectLoading(false); });
    return () => { disposed = true; };
  }, [projectId]);

  const taskId = task?._id;
  const taskActive = ACTIVE.has(task?.status);
  useEffect(() => {
    if (!taskId) return;
    let disposed = false;
    let timer;
    let after = 0;
    async function refresh() {
      try {
        const [detail, activity] = await Promise.all([apiJson(`/api/tasks/${taskId}`), apiJson(`/api/tasks/${taskId}/events?after=${after}`)]);
        if (disposed) return;
        setTask(detail.task);
        setTasks(items => items.map(item => item._id === taskId ? detail.task : item));
        if (activity.events.length) { after = activity.events[activity.events.length - 1].seq; setEvents(items => [...items, ...activity.events]); }
        if (activity.events.some(event => event.type === "memory")) {
          const memoryResult = await apiJson(`/api/memories?projectId=${detail.task.projectId}`);
          if (!disposed && projectRef.current === detail.task.projectId) setMemories(memoryResult.memories);
        }
        if (!disposed && (ACTIVE.has(detail.task.status) || activity.events.length === 100)) timer = setTimeout(refresh, 2000);
      } catch (failure) { if (!disposed) reportError(failure); }
    }
    refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [taskId]);

  function editProject(item) {
    setEditor({ title: item ? "项目设置" : "创建项目", kind: "project", item, fields: [
      { name: "name", label: "项目名称", value: item?.name, required: true, maxLength: 100 },
      { name: "description", label: "项目介绍", value: item?.description, multiline: true, rows: 2 },
      { name: "instructions", label: "项目指令", value: item?.instructions, multiline: true, hint: "告诉 AI 这个项目的目标、工作方式和需要遵守的要求。" },
    ] });
  }
  function editSkill(item, content = "") {
    setEditor({ title: item ? "编辑技能" : "添加技能", kind: "skill", item, fields: [
      { name: "name", label: "技能名称", value: item?.name, required: true, maxLength: 100 },
      { name: "description", label: "何时使用", value: item?.description, multiline: true, rows: 2 },
      { name: "content", label: "技能内容", value: item ? item.content : content, required: true, multiline: true, rows: 10 },
    ] });
  }
  function editMemory(item) {
    setEditor({ title: item ? "编辑记忆" : "添加记忆", kind: "memory", item, fields: [
      { name: "content", label: "希望 AI 记住什么？", value: item?.content, required: true, multiline: true },
      { name: "projectId", label: "使用范围", value: item ? (item.projectId || "") : projectId, type: "select", options: [{ value: "", label: "个人记忆 · 所有项目" }, ...projects.map(p => ({ value: p._id, label: p.name }))] },
    ] });
  }
  function confirmDelete(kind, item, message) { setEditor({ title: "确认删除", kind: "delete", targetKind: kind, item, message }); }
  async function saveEditor(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      if (editor.kind === "delete") {
        const { targetKind, item } = editor;
        const path = targetKind === "file" ? `/api/projects/${projectId}/files/${item.fileId}` : `/api/${{ project: "projects", skill: "skills", memory: "memories" }[targetKind]}/${item._id}`;
        await apiJson(path, { method: "DELETE" });
        if (targetKind === "project") { setProjects(items => items.filter(p => p._id !== item._id)); if (item._id === projectId) { pickProject(""); setTasks([]); setFiles([]); setMemories([]); setConversations([]); } }
        if (targetKind === "skill") setSkills(items => items.filter(s => s._id !== item._id));
        if (targetKind === "memory") setMemories(items => items.filter(m => m._id !== item._id));
        if (targetKind === "file") setFiles(items => items.filter(f => f.fileId !== item.fileId));
      } else if (editor.kind === "media") {
        if (values.audioProvider && !values.voiceId.trim()) throw new Error("启用配音时，请填写所选供应商的音色编号。");
        const next = {};
        if (values.imageSize) next.image = { size: values.imageSize };
        if (values.audioProvider) {
          next.audio = { provider: values.audioProvider, voiceId: values.voiceId.trim(), format: values.format, sampleRate: Number(values.sampleRate) };
          if (values.audioProvider === "qwen") Object.assign(next.audio, { instruction: values.instruction, rate: Number(values.rate), pitch: Number(values.pitch), volume: Number(values.volume), languageHint: "" });
          if (values.audioProvider === "minimax") Object.assign(next.audio, { model: values.audioModel, emotion: values.emotion, speed: Number(values.minimaxSpeed), volume: Number(values.minimaxVolume), pitch: Number(values.minimaxPitch), languageBoost: values.languageBoost });
          if (values.audioProvider === "doubao") Object.assign(next.audio, { instruction: values.doubaoInstruction, speechRate: Number(values.speechRate), loudnessRate: Number(values.loudnessRate), pitchRate: Number(values.pitchRate) });
        }
        if (values.videoMode) next.video = { mode: values.videoMode, resolution: values.resolution, ...(values.videoMode === "edit" ? { audioSetting: values.audioSetting } : { ...(values.videoMode === "first-frame" ? {} : { ratio: values.ratio }), duration: Number(values.duration) }), watermark: values.watermark === "true" };
        if (values.enhancementResolution) next.enhancement = { resolution: values.enhancementResolution, bitrate: { mode: "level", value: values.bitrate } };
        setMediaSettings(next);
      } else if (editor.kind === "attachConversation") {
        await apiJson(`/api/conversations/${values.conversationId}`, { method: "PUT", body: { projectId } });
        const result = await apiJson(`/api/conversations?projectId=${projectId}`);
        setConversations(result.conversations);
      } else if (editor.kind === "conversation") {
        await apiJson(`/api/conversations/${editor.item._id}`, { method: "PUT", body: { projectId: values.projectId || null } });
        setConversations(items => items.filter(c => c._id !== editor.item._id)); setConversation(null);
      } else {
        const paths = { project: "projects", skill: "skills", memory: "memories" };
        const kind = editor.kind;
        if (kind === "memory") values.projectId = values.projectId || null;
        if (kind === "project") values.memoryEnabled = editor.item ? editor.item.memoryEnabled : true;
        if (kind === "skill") values.enabled = editor.item ? editor.item.enabled : true;
        const result = await apiJson(`/api/${paths[kind]}${editor.item ? `/${editor.item._id}` : ""}`, { method: editor.item ? "PUT" : "POST", body: values });
        const saved = result[kind];
        const update = items => editor.item ? items.map(item => item._id === saved._id ? saved : item) : [saved, ...items];
        if (kind === "project") { setProjects(update); if (!editor.item) pickProject(saved._id); }
        if (kind === "skill") setSkills(update);
        if (kind === "memory") { const result = await apiJson(`/api/memories?projectId=${projectId}`); setMemories(result.memories); }
      }
      setEditor(null);
    });
  }
  function submitTask(event) {
    event.preventDefault();
    if (!prompt.trim() || !projectId || projectLoading) return;
    const submittedProject = projectId;
    run(async () => {
      const result = await apiJson("/api/tasks", { method: "POST", body: { projectId, prompt: prompt.trim(), model, requestId: crypto.randomUUID(), ...(continuing && task ? { parentTaskId: task._id } : {}), ...(conversation ? { sourceConversationId: conversation._id } : {}), mediaSettings } });
      if (projectRef.current !== submittedProject) return;
      setTasks(items => [result.task, ...items]); pickTask(result.task); setPrompt("");
    });
  }
  function uploadFile(event) {
    const file = event.target.files[0]; event.target.value = "";
    if (!file) return;
    const submittedProject = projectId;
    run(async () => { const form = new FormData(); form.append("file", file); const result = await apiRequest(`/api/projects/${submittedProject}/files`, { method: "POST", body: form }); if (projectRef.current === submittedProject) setFiles(items => [result.file, ...items]); });
  }
  function showConversation(item) {
    taskRef.current = null; setTask(null); setEvents([]); setContinuing(false);
    const requestedProject = projectId;
    run(async () => { const result = await apiJson(`/api/conversations/${item._id}`); if (projectRef.current === requestedProject) { setConversation(result.conversation); setDrawer(null); } });
  }
  function editMedia() {
    const options = entries => entries.map(item => ({ value: String(item.id), label: item.label }));
    const off = { value: "", label: "不启用" };
    const qwen = values => values.audioProvider === "qwen";
    const minimax = values => values.audioProvider === "minimax";
    const doubao = values => values.audioProvider === "doubao";
    setEditor({ title: "创作设置", kind: "media", fields: [
      { name: "imageSize", label: "图片生成", type: "select", value: mediaSettings.image?.size || "", options: [off, ...options(IMAGE_SIZE_OPTIONS)] },
      { name: "audioProvider", label: "配音供应商", type: "select", value: mediaSettings.audio?.provider || "", options: [off, { value: "qwen", label: "通义千问" }, { value: "minimax", label: "MiniMax" }, { value: "doubao", label: "豆包" }] },
      { name: "voiceId", label: "音色编号", value: mediaSettings.audio?.voiceId || "", hint: "填写对应供应商的音色编号，可在创作中心的配音页面查看和试听。" },
      { name: "format", label: "音频格式", type: "select", value: mediaSettings.audio?.format || "mp3", options: [{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }] },
      { name: "sampleRate", label: "音频采样率", type: "select", value: String(mediaSettings.audio?.sampleRate || 24000), options: values => values.audioProvider === "minimax" ? options(MINIMAX_AUDIO_SAMPLE_RATE_OPTIONS) : [16000, 24000, 48000].map(rate => ({ value: String(rate), label: `${rate / 1000} kHz` })) },
      { name: "instruction", label: "配音要求", value: mediaSettings.audio?.instruction || "", multiline: true, rows: 2, when: qwen },
      { name: "rate", label: "语速（1 为正常）", type: "number", value: mediaSettings.audio?.rate ?? 1, min: 0.5, max: 2, step: 0.1, when: qwen },
      { name: "pitch", label: "音调（1 为正常）", type: "number", value: mediaSettings.audio?.provider === "qwen" ? mediaSettings.audio.pitch : 1, min: 0.5, max: 2, step: 0.1, when: qwen },
      { name: "volume", label: "音量（0–100）", type: "number", value: mediaSettings.audio?.provider === "qwen" ? mediaSettings.audio.volume : 50, min: 0, max: 100, step: 1, when: qwen },
      { name: "audioModel", label: "MiniMax 配音模型", type: "select", value: mediaSettings.audio?.model || MINIMAX_AUDIO_MODELS[0].id, options: options(MINIMAX_AUDIO_MODELS), when: minimax },
      { name: "emotion", label: "情绪", type: "select", value: mediaSettings.audio?.emotion || "", options: options(MINIMAX_AUDIO_EMOTION_OPTIONS), when: minimax },
      { name: "languageBoost", label: "语言增强", type: "select", value: mediaSettings.audio?.languageBoost || "", options: options(MINIMAX_AUDIO_LANGUAGE_OPTIONS), when: minimax },
      { name: "minimaxSpeed", label: "语速（1 为正常）", type: "number", value: mediaSettings.audio?.speed ?? 1, min: 0.5, max: 2, step: 0.1, when: minimax },
      { name: "minimaxVolume", label: "音量（1 为正常）", type: "number", value: mediaSettings.audio?.provider === "minimax" ? mediaSettings.audio.volume : 1, min: 0.1, max: 10, step: 0.1, when: minimax },
      { name: "minimaxPitch", label: "音调（0 为正常）", type: "number", value: mediaSettings.audio?.provider === "minimax" ? mediaSettings.audio.pitch : 0, min: -12, max: 12, step: 1, when: minimax },
      { name: "doubaoInstruction", label: "配音要求", value: mediaSettings.audio?.instruction || "", multiline: true, rows: 2, maxLength: 300, when: doubao },
      { name: "speechRate", label: "语速（0 为正常）", type: "number", value: mediaSettings.audio?.speechRate ?? 0, min: -50, max: 100, step: 1, when: doubao },
      { name: "loudnessRate", label: "音量（0 为正常）", type: "number", value: mediaSettings.audio?.loudnessRate ?? 0, min: -50, max: 100, step: 1, when: doubao },
      { name: "pitchRate", label: "音调（0 为正常）", type: "number", value: mediaSettings.audio?.pitchRate ?? 0, min: -12, max: 12, step: 1, when: doubao },
      { name: "videoMode", label: "视频生成方式", type: "select", value: mediaSettings.video?.mode || "", options: [off, ...options(VIDEO_MODE_OPTIONS)], hint: "参考图片和视频请先上传到项目资料，在任务中说明使用哪些素材。" },
      { name: "resolution", label: "视频分辨率", type: "select", value: mediaSettings.video?.resolution || "720P", options: values => options(VIDEO_RESOLUTION_OPTIONS.filter(option => values.videoMode !== "edit" || option.id !== "480P")) },
      { name: "ratio", label: "视频比例", type: "select", value: mediaSettings.video?.ratio || "16:9", options: options(VIDEO_ASPECT_RATIO_OPTIONS), when: values => ["text", "reference"].includes(values.videoMode) },
      { name: "duration", label: "视频时长", type: "select", value: String(mediaSettings.video?.duration || 5), options: options(VIDEO_DURATION_OPTIONS), when: values => values.videoMode !== "edit" },
      { name: "audioSetting", label: "视频编辑音频", type: "select", value: mediaSettings.video?.audioSetting || "auto", options: [{ value: "auto", label: "自动处理" }, { value: "origin", label: "保留原音频" }], when: values => values.videoMode === "edit" },
      { name: "watermark", label: "视频水印", type: "select", value: String(mediaSettings.video?.watermark === true), options: [{ value: "false", label: "不添加" }, { value: "true", label: "添加" }] },
      { name: "enhancementResolution", label: "视频画质增强", type: "select", value: mediaSettings.enhancement?.resolution || "", options: [off, ...["720p", "1080p", "2k"].map(value => ({ value, label: value }))] },
      { name: "bitrate", label: "增强后画质", type: "select", value: mediaSettings.enhancement?.bitrate.value || "medium", options: [{ value: "low", label: "较小文件" }, { value: "medium", label: "标准" }, { value: "high", label: "高画质" }] },
    ] });
  }
  function attachConversation() {
    run(async () => {
      const result = await apiJson("/api/conversations");
      const choices = result.conversations.filter(item => item.projectId !== projectId);
      if (!choices.length) { setError("没有可关联的其他对话，请先在 Chat 中创建对话。"); return; }
      setEditor({ title: "关联已有对话", kind: "attachConversation", fields: [{ name: "conversationId", label: "选择对话", type: "select", value: choices[0]._id, options: choices.map(item => ({ value: item._id, label: item.title })), hint: "对话会移入当前项目。" }] });
    });
  }
  const filteredProjects = projects.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()));

  return <div className={styles.workbench}>
    <header className={styles.header}>
      <div className={styles.headerLeft}><IconButton title="打开项目" onClick={() => setDrawer("left")}><Menu size={20} /></IconButton><Link href="/" className={styles.brand}><Layers size={21} /><span>Vectaix<span className={styles.brandLight}> / </span></span></Link><ModeSwitcher /></div>
      <div className={styles.headerRight}><CreditShell /><IconButton title="打开项目资料" onClick={() => setDrawer("right")}><PanelRight size={20} /></IconButton></div>
    </header>
    {error && <div className={styles.error} role="alert"><span>{error}{needsLogin && <> · <Link href="/">前往登录</Link></>}</span><IconButton title="关闭提示" onClick={() => setError("")}><X size={16} /></IconButton></div>}
    {drawer && <button className={styles.backdrop} aria-label="收起侧栏" onClick={() => setDrawer(null)} />}
    <div className={styles.columns}>
      <aside className={`${styles.sidebar} ${drawer === "left" ? styles.open : ""}`}>
        <div className={styles.sectionTitle}><span>我的空间</span><IconButton title="创建项目" onClick={() => editProject(null)} disabled={busy || needsLogin}><Plus size={17} /></IconButton></div>
        <div className={styles.search}><Search size={15} /><input placeholder="查找项目" aria-label="查找项目" value={filter} onChange={event => setFilter(event.target.value)} /></div>
        <div className={styles.projectList}>{loading ? <p className={styles.muted}>正在载入项目…</p> : filteredProjects.map(item => <button key={item._id} className={`${styles.projectItem} ${projectId === item._id ? styles.selected : ""}`} onClick={() => pickProject(item._id)}><Folder size={17} /><span>{item.name}</span><ChevronRight size={14} /></button>)}{!loading && !projects.length && <p className={styles.muted}>创建项目，集中管理任务与资料。</p>}</div>
        <button className={styles.newProject} onClick={() => editProject(null)} disabled={busy || needsLogin}><FolderPlus size={16} />创建项目</button>
        <div className={styles.separator} />
        <div className={styles.sectionTitle}><span>项目任务</span>{project && <IconButton title="新建任务" onClick={() => { pickTask(null); promptRef.current?.focus(); }}><Plus size={17} /></IconButton>}</div>
        <div className={styles.taskList}>{projectLoading ? <p className={styles.muted}>正在载入任务…</p> : tasks.map(item => <button key={item._id} onClick={() => pickTask(item)} className={`${styles.taskItem} ${taskId === item._id ? styles.selected : ""}`}><span className={`${styles.statusDot} ${ACTIVE.has(item.status) ? styles.live : ""}`} /><span><strong>{item.prompt}</strong><small>{STATUS[item.status]}</small></span></button>)}{project && !projectLoading && !tasks.length && <p className={styles.muted}>在中间输入需求，开始第一个任务。</p>}</div>
        {project && <><div className={styles.sectionTitle}><span>项目对话</span><IconButton title="关联已有对话" onClick={attachConversation} disabled={busy}><Plus size={16} /></IconButton></div><div className={styles.conversationList}>{conversations.map(item => <button key={item._id} className={styles.taskItem} onClick={() => showConversation(item)}><MessageSquare size={15} /><strong>{item.title}</strong></button>)}</div></>}
        <div className={styles.sidebarFooter}><button onClick={() => { setPanel("skills"); setDrawer("right"); }}><BookOpen size={16} />技能库<span>{skills.filter(s => s.enabled).length}</span></button><button onClick={() => { setPanel("memory"); setDrawer("right"); }}><Brain size={16} />记忆管理</button><Link href="/media">打开创作中心<ArrowUpRight size={15} /></Link></div>
      </aside>
      <main className={styles.main}>
        <div className={styles.projectHeader}><div><span className={styles.eyebrow}>WORKSPACE</span><h1>{project ? project.name : "工作台"}</h1></div>{project && <IconButton title="项目设置" onClick={() => editProject(project)}><Settings2 size={19} /></IconButton>}</div>
        <div className={styles.canvas}>
          {!task && !conversation && <div className={styles.welcome}><div className={styles.welcomeMark}><Layers size={30} strokeWidth={1.3} /></div><span className={styles.eyebrow}>从想法，到成果</span><h2>{project ? "让工作，在这里发生。" : "给每一个想法，一个空间。"}</h2><p>{project ? project.description || "放入资料，写下目标。让 AI 围绕你的项目持续工作。" : "把任务、资料和创作成果放在一起，和 AI 一起把事情做完。"}</p>{project ? <div className={styles.starters}>{STARTERS.map(({ icon: Icon, title, text }) => <button key={title} onClick={() => { setPrompt(text); promptRef.current?.focus(); }}><Icon size={19} strokeWidth={1.5} /><span>{title}</span><ArrowUpRight size={15} /></button>)}</div> : <button className={styles.primary} onClick={() => editProject(null)} disabled={loading || needsLogin}><Plus size={17} />创建第一个项目</button>}</div>}
          {task && <article className={styles.taskDetail}><div className={styles.taskMeta}><span className={`${styles.statusBadge} ${taskActive ? styles.activeBadge : ""}`}>{taskActive ? <Loader2 size={13} className={styles.spin} /> : task.status === "completed" ? <Check size={13} /> : <Circle size={13} />}{STATUS[task.status]}</span><span>{new Date(task.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div><h2>{task.prompt}</h2>
            <details className={styles.activity} open={taskActive}><summary><Sparkles size={15} />执行过程<span>{events.length} 条记录</span></summary><ol>{events.map(item => <li key={item.seq}><span className={styles.eventDot} /><div><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div></li>)}</ol>{!events.length && <p className={styles.muted}>正在读取执行记录…</p>}</details>
            {task.output && <div className={styles.output}><Markdown enableMath>{task.output}</Markdown></div>}{task.error && <p role="alert" className={styles.taskError}>{task.error}</p>}
            {!taskActive && <div className={styles.resultFooter}><span>{task.billingReviewRequired ? "费用正在核查" : `已使用 ${Number(task.chargedPoints || 0).toLocaleString("zh-CN")} 积分`}</span><button className={styles.secondary} onClick={() => { setContinuing(true); promptRef.current?.focus(); }}>继续这个任务<ArrowUpRight size={14} /></button></div>}
          </article>}
          {conversation && <article className={styles.taskDetail}><div className={styles.taskMeta}><MessageSquare size={14} /><span>项目对话</span><button className={styles.textButton} onClick={() => setEditor({ title: "移动对话", kind: "conversation", item: conversation, fields: [{ name: "projectId", label: "目标项目", type: "select", value: projectId, options: [{ value: "", label: "移出项目" }, ...projects.map(p => ({ value: p._id, label: p.name }))] }] })}>移动对话</button></div><h2>{conversation.title}</h2>{conversation.messages?.map((message, index) => <div className={styles.conversationMessage} key={index}><span className={styles.eyebrow}>{message.role === "user" ? "你" : "AI"}</span><Markdown>{message.type === "parts" ? message.parts.filter(part => typeof part.text === "string").map(part => part.text).join("\n") : message.content}</Markdown></div>)}</article>}
        </div>
        {project && <div className={styles.composerWrap}>{continuing && <div className={styles.continuing}>接着上一个任务继续<IconButton title="取消继续任务" onClick={() => setContinuing(false)}><X size={14} /></IconButton></div>}<form className={styles.composer} onSubmit={submitTask}><textarea ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} placeholder="描述你的目标，或告诉 AI 接下来做什么…" aria-label="任务需求" maxLength={16000} rows={3} disabled={needsLogin} /><div className={styles.composerTools}><div className={styles.modelControl}><select aria-label="任务模型" value={model} onChange={event => setModel(event.target.value)}>{CHAT_MODELS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><IconButton title="创作设置" onClick={editMedia}><Settings2 size={15} /></IconButton></div>{taskActive ? <button type="button" className={styles.stop} disabled={busy} onClick={() => run(async () => { const result = await apiJson(`/api/tasks/${taskId}/stop`, { method: "POST" }); if (taskRef.current === taskId) { setTask(result.task); setTasks(items => items.map(item => item._id === taskId ? result.task : item)); } })}><Square size={13} />停止</button> : <button className={styles.send} aria-label="开始任务" disabled={busy || !prompt.trim() || projectLoading || needsLogin}>{busy ? <Loader2 size={18} className={styles.spin} /> : <ArrowUp size={20} />}</button>}</div></form><p className={styles.composerHint}>{conversation ? "基于当前对话创建任务 · " : ""}项目资料与已启用的技能会用于任务{limits && ` · 最多 ${limits.maxSteps} 步 / ${limits.maxMinutes} 分钟 · 同时 ${limits.concurrency} 个任务，每人 ${limits.perUserConcurrency} 个`}</p></div>}
      </main>
      <aside className={`${styles.resources} ${drawer === "right" ? styles.open : ""}`}>
        <div className={styles.resourceHeader}><span>项目上下文</span><IconButton title="关闭资料栏" onClick={() => setDrawer(null)}><X size={17} /></IconButton></div>
        <div className={styles.tabs} role="tablist" aria-label="项目上下文">{[{ id: "files", label: "资料" }, { id: "results", label: "成果" }, { id: "skills", label: "技能" }, { id: "memory", label: "记忆" }].map(item => <button key={item.id} role="tab" aria-selected={panel === item.id} onClick={() => setPanel(item.id)} className={panel === item.id ? styles.tabActive : ""}>{item.label}</button>)}</div>
        <div className={styles.resourceContent}>
          {panel === "files" && <><div className={styles.panelIntro}><h2>项目资料</h2><p>上传文档、图片、音频或视频，每个文件不超过 20 MB。</p></div>{project ? <><input ref={uploadRef} type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.mp3,.wav,.m4a,.aac,.ogg,.weba,.mp4,.mov,.webm,.m4v" hidden onChange={uploadFile} /><button className={styles.upload} disabled={busy} onClick={() => uploadRef.current.click()}><Upload size={18} /><span>{busy ? "处理中…" : "上传项目文件"}</span></button><div className={styles.fileList}>{files.map(file => <div className={styles.file} key={file.fileId}><FileText size={19} /><a href={file.url} target="_blank" rel="noreferrer"><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB</small></a><IconButton title={`删除 ${file.name}`} onClick={() => confirmDelete("file", file, "删除这份项目资料？后续任务将无法使用它。")}><Trash2 size={14} /></IconButton></div>)}</div>{!files.length && <Empty icon={FileText}>还没有资料<br />添加文档、表格或媒体，开始积累项目知识。</Empty>}<div className={styles.instructions}><div className={styles.sectionTitle}><span>项目指令</span><IconButton title="编辑项目指令" onClick={() => editProject(project)}><Pencil size={14} /></IconButton></div><p>{project.instructions || "添加项目目标、写作风格和工作要求。"}</p></div><button className={styles.deleteProject} onClick={() => confirmDelete("project", project, "删除这个项目及其关联任务、资料和项目记忆？此操作无法撤销。")}>删除项目</button></> : <Empty icon={Folder}>选择或创建一个项目，查看相关资料。</Empty>}</>}
          {panel === "results" && <><div className={styles.panelIntro}><h2>交付与依据</h2><p>当前任务生成的文件和引用来源。</p></div>{task?.artifacts?.map(file => <div className={styles.artifact} key={file.fileId}>{file.mimeType.startsWith("image/") && <a href={file.url} target="_blank" rel="noreferrer"><Image src={file.url} alt={file.name} width={600} height={450} unoptimized /></a>}{file.mimeType.startsWith("video/") && <video src={file.url} controls preload="metadata" />}{file.mimeType.startsWith("audio/") && <audio src={file.url} controls preload="metadata" />}<a className={styles.artifactLink} href={file.url} download={file.name}><FileText size={17} /><span>{file.name}</span><Download size={15} /></a></div>)}{!task?.artifacts?.length && <Empty icon={Layers}>任务产出的文件会出现在这里。</Empty>}{task?.citations?.length > 0 && <div className={styles.sources}><h3>引用来源</h3>{task.citations.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noreferrer"><span>{index + 1}</span><strong>{source.title || source.url}</strong><ArrowUpRight size={14} /></a>)}</div>}</>}
          {panel === "skills" && <><div className={styles.panelIntro}><h2>技能库</h2><p>把专业方法保存成技能，供任务使用。</p></div><div className={styles.buttonRow}><button className={styles.secondary} onClick={() => editSkill(null)}><Plus size={15} />添加技能</button><input ref={skillRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={event => { const file = event.target.files[0]; event.target.value = ""; if (file) run(async () => editSkill(null, await file.text())); }} /><button className={styles.secondary} onClick={() => skillRef.current.click()} disabled={busy}><Upload size={14} />导入</button></div>{skills.map(skill => <div className={styles.card} key={skill._id}><Toggle checked={skill.enabled} label={skill.name} disabled={busy} onChange={() => run(async () => { const result = await apiJson(`/api/skills/${skill._id}`, { method: "PUT", body: { enabled: !skill.enabled } }); setSkills(items => items.map(item => item._id === skill._id ? result.skill : item)); })} /><p>{skill.description}</p><div className={styles.cardActions}><button onClick={() => editSkill(skill)}>编辑</button>{!skill.builtinKey && <button onClick={() => confirmDelete("skill", skill, `删除技能「${skill.name}」？`)}>删除</button>}</div></div>)}{!skills.length && <Empty icon={BookOpen}>添加工作方法，或导入 SKILL.md 技能文件。</Empty>}</>}
          {panel === "memory" && <><div className={styles.panelIntro}><h2>记忆管理</h2><p>让 AI 记住你的偏好与项目中的重要信息。</p></div><div className={styles.memorySettings}><Toggle label="个人记忆" checked={memoryEnabled} disabled={busy} onChange={() => run(async () => { const result = await apiJson("/api/memories/settings", { method: "PUT", body: { enabled: !memoryEnabled } }); setMemoryEnabled(result.enabled); })} />{project && <Toggle label="项目记忆" checked={project.memoryEnabled} disabled={busy} onChange={() => run(async () => { const result = await apiJson(`/api/projects/${projectId}`, { method: "PUT", body: { memoryEnabled: !project.memoryEnabled } }); setProjects(items => items.map(item => item._id === projectId ? result.project : item)); })} />}</div><button className={styles.secondary} onClick={() => editMemory(null)}><Plus size={15} />添加记忆</button>{memories.map(memory => <div className={styles.card} key={memory._id}><small>{memory.projectId ? "项目记忆" : "个人记忆"}</small><p>{memory.content}</p><div className={styles.cardActions}><button onClick={() => editMemory(memory)}>编辑</button><button onClick={() => confirmDelete("memory", memory, "删除这条记忆？AI 将不再使用它。")}>删除</button></div></div>)}{!memories.length && <Empty icon={Brain}>还没有记忆。添加希望 AI 长期记住的信息。</Empty>}</>}
        </div>
      </aside>
    </div>
    {editor && <Editor editor={editor} close={() => { if (!busy) setEditor(null); }} save={saveEditor} busy={busy} error={error} />}
  </div>;
}
