'use client';
import { useI18n } from '@/lib/client/i18n';
import { useEffect, useState } from 'react';
import ConfirmModal from '@/app/components/modals/ConfirmModal';
import { apiJson } from '@/lib/client/apiClient';
import { Section, Field, Action, ErrorNotice, inputClass } from '../SettingsUI';

export default function UsagePanel() {
  const { t, formatDate, formatNumber, localizeMessage } = useI18n();
  const money = value => formatNumber(value, { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const bytes = value => value >= 1073741824 ? `${formatNumber(value / 1073741824, { maximumFractionDigits: 2 })} GB` : value >= 1048576 ? `${formatNumber(value / 1048576, { maximumFractionDigits: 1 })} MB` : value >= 1024 ? `${formatNumber(value / 1024, { maximumFractionDigits: 1 })} KB` : `${formatNumber(value)} B`;
  const statusLabels = { queued: t("等待中", "Queued"), running: t("执行中", "Running"), waiting_media: t("正在生成素材", "Generating media"), waiting_approval: t("等待你的确认", "Awaiting your confirmation"), completed: t("已完成", "Completed"), failed: t("失败", "Failed"), stopped: t("已停止", "Stopped"), interrupted: t("已中断", "Interrupted") };
  const eventLabels = {
    plan: t("更新执行计划", "Updating the plan"), agent_start: t("子助手开始调查", "Research assistant started"), agent_complete: t("子助手完成调查", "Research assistant finished"),
    started: t("任务开始", "Task started"), completed: t("任务完成", "Task completed"), failed: t("任务失败", "Task failed"), stopped: t("任务已停止", "Task stopped"), interrupted: t("任务已中断", "Task interrupted"),
    model: t("分析资料", "Analyzing information"), billing: t("记录花费", "Recording costs"), sources: t("整理来源", "Organizing sources"), artifact: t("保存成果", "Saving results"),
    context: t("整理任务进度", "Reviewing progress"), tool_start: t("开始执行步骤", "Step started"), tool_result: t("步骤执行结果", "Step result"),
    media_submit: t("开始生成素材", "Media generation started"), media_wait: t("等待素材生成", "Waiting for media"), approval_required: t("等待你的确认", "Awaiting your confirmation"),
  };
  const toolLabels = {
    update_plan: t("更新执行计划", "Updating the plan"), delegate_research: t("委派资料调查", "Delegating research"),
    list_documents: t("查看项目资料", "Listing project files"), read_document: t("阅读项目资料", "Reading project files"), list_library: t("查看文件库", "Listing library files"),
    read_file: t("读取文件", "Reading a file"), edit_file: t("编辑文件", "Editing a file"), load_skill: t("读取技能", "Loading a skill"), read_skill_file: t("阅读技能资料", "Reading skill resources"),
    read_skill_image: t("查看技能图片", "Viewing a skill image"),
    search_web: t("联网搜索", "Searching the web"), read_webpage: t("阅读网页", "Reading a webpage"), create_report: t("生成报告", "Creating a report"), create_table: t("生成表格", "Creating a spreadsheet"),
    inspect_table: t("查看表格", "Inspecting a spreadsheet"), transform_table: t("整理表格", "Updating a spreadsheet"), read_task_step: t("查看先前步骤", "Reviewing an earlier step"), save_progress: t("保存任务进度", "Saving progress"),
    media_capabilities: t("查看媒体工具", "Checking media tools"), list_media: t("查看素材", "Listing media"), generate_image: t("生成图片", "Generating an image"), edit_image: t("编辑图片", "Editing an image"), generate_speech: t("生成语音", "Generating speech"),
    browser: t("操作网页", "Using the browser"),
    run_python: t("运行 Python", "Running Python"), run_skill_script: t("执行技能脚本", "Running a skill script"),
  };
  function eventLabel(event) {
    if (!event.tool) return eventLabels[event.type];
    if (event.tool.startsWith('ext_')) return t("使用外部连接", "Using an external connection");
    return toolLabels[event.tool];
  }

  const eventStatusLabels = { ...statusLabels, done: t("成功", "Succeeded"), settled: t("已记账", "Recorded"), review_required: t("费用待核查", "Cost under review"), pending: t("等待处理", "Pending"), reserved: t("等待结算", "Awaiting settlement"), settling: t("正在结算", "Settling"), released: t("未计费", "Not charged"), rejected: t("已取消计费", "Charge canceled") };
  const categoryLabels = { image: t("图片", "Images"), audio: t("音频", "Audio"), video: t("视频", "Video"), document: t("文档", "Documents"), backups: t("加密备份", "Encrypted backups") };

  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()));
  const [taskId, setTaskId] = useState('');
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);
  const [storage, setStorage] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [appliedQuery, setAppliedQuery] = useState(() => new URLSearchParams({ month }).toString());
  useEffect(() => {
    let alive = true;
    Promise.all([apiJson('/api/usage'), apiJson('/api/usage/logs'), apiJson('/api/usage/storage')]).then(([usage, logs, files]) => { if (!alive) return; setData(usage); setEvents(logs.events); setStorage(files); }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, []);
  const act = async task => { setBusy(true); setError(''); setNotice(''); try { await task(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const load = async (nextMonth = month, nextTaskId = taskId) => {
    const nextQuery = new URLSearchParams({ month: nextMonth, ...(nextTaskId ? { taskId: nextTaskId } : {}) }).toString();
    const [usage, logs] = await Promise.all([apiJson(`/api/usage?${nextQuery}`), apiJson(`/api/usage/logs?${nextQuery}`)]);
    setData(usage); setEvents(logs.events); setAppliedQuery(nextQuery);
  };
  const monthLabel = id => formatDate(id.length === 7 ? `${id}-01T00:00:00` : `${id}T00:00:00`, { year: "numeric", month: "short", ...(id.length > 7 ? { day: "numeric" } : {}) });
  const requestsText = item => t("{count} 次调用", "{count} requests", { count: formatNumber(item.requests) });
  const summaryCard = (label, value) => <div className="min-w-0 rounded-xl bg-zinc-50 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 break-all text-2xl font-semibold tabular-nums">{value}</p></div>;

  return <div className="min-w-0 space-y-5">
    <ErrorNotice error={error} />
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    <Section title={t("花费", "Costs")} description={t("查看人民币花费、历史账单和任务花费。每月 1 日按北京时间重新累计，历史记录会保留。", "Review costs in CNY, past bills, and task costs. Monthly totals restart on the first day of each month in Beijing time (UTC+8). Past records are kept.")}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); act(() => load()); }}>
        <Field label={t("账单月份", "Billing month")} className={`${inputClass} sm:w-48`} type="month" required value={month} onChange={event => setMonth(event.target.value)} />
        <Field label={t("任务编号", "Task ID")} className={`${inputClass} sm:w-72`} value={taskId} placeholder={t("留空查看全部任务", "Leave blank for all tasks")} onChange={event => setTaskId(event.target.value)} />
        <Action type="submit" primary disabled={busy}>{t("查询", "Apply")}</Action>
      </form>
      {data && <>
        <div className="grid gap-3 sm:grid-cols-3">
          {summaryCard(t("本月花费（{month}）", "This month ({month})", { month: formatDate(`${data.currentMonth.month}-01T00:00:00`, { year: "numeric", month: "long" }) }), money(data.currentMonth.costCny))}
          {summaryCard(t("所选范围花费", "Cost for selected range"), money(data.summary.costCny))}
          {summaryCard(t("已记录调用", "Recorded requests"), formatNumber(data.summary.requests))}
        </div>
        {data.currentMonth.unpricedRequests > 0 && <p className="text-xs text-amber-700">{t("本月有 {count} 次调用的费用待记录，金额暂未计入。", "Costs for {count} requests this month are pending and excluded from the total.", { count: formatNumber(data.currentMonth.unpricedRequests) })}</p>}
        {data.summary.unpricedRequests > 0 && <p className="text-xs text-amber-700">{t("所选范围有 {count} 次调用的费用待记录，金额暂未计入。", "Costs for {count} requests in this range are pending and excluded from the total.", { count: formatNumber(data.summary.unpricedRequests) })}</p>}
        <details open className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"><summary className="cursor-pointer text-sm font-medium">{t("历史月度花费", "Monthly cost history")}</summary><div className="mt-3 space-y-1">{data.monthly.map(item => <button type="button" key={item._id} onClick={() => { setMonth(item._id); setTaskId(''); act(() => load(item._id, '')); }} className="flex w-full flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-zinc-100"><span>{monthLabel(item._id)}</span><span className="tabular-nums text-zinc-600">{money(item.costCny)}{t("，", ", ")}{requestsText(item)}{item.unpricedRequests > 0 ? t("，{count} 次费用待记录", ", {count} costs pending", { count: formatNumber(item.unpricedRequests) }) : ''}</span></button>)}{!data.monthly.length && <p className="text-sm text-zinc-500">{t("暂无历史花费。", "No cost history yet.")}</p>}</div></details>
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"><summary className="cursor-pointer text-sm font-medium">{t("每日花费", "Daily costs")}</summary><div className="mt-3 space-y-2">{data.daily.map(item => <div key={item._id} className="flex flex-wrap justify-between gap-x-3 text-sm"><span>{formatDate(`${item._id}T00:00:00`, { dateStyle: "medium" })}</span><span className="tabular-nums text-zinc-600">{money(item.costCny)}{t("，", ", ")}{requestsText(item)}</span></div>)}{!data.daily.length && <p className="text-sm text-zinc-500">{t("所选范围没有花费。", "No costs in this range.")}</p>}</div></details>
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"><summary className="cursor-pointer text-sm font-medium">{t("任务花费（最多 200 条）", "Task costs (up to 200)")}</summary><div className="mt-3 space-y-2">{data.tasks.map(task => <button type="button" key={task._id} className="block w-full rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 dark:border-zinc-700" onClick={() => { setTaskId(task._id); act(() => load(month, task._id)); }}><span className="text-sm">{statusLabels[task.status]}<span className="ml-2 tabular-nums">{money(task.costCny)}</span></span><span className="mt-1 block break-all text-xs text-zinc-500">{task._id}<span className="ml-2">{formatDate(task.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span></span></button>)}{!data.tasks.length && <p className="text-sm text-zinc-500">{t("所选范围没有任务。", "No tasks in this range.")}</p>}</div></details>
      </>}
    </Section>

    <Section title={t("工具执行记录", "Tool activity")} description={t("查看每一步的执行状态、耗时和失败原因。", "Review each step’s status, duration, and any errors.")}>
      <a className="inline-flex min-h-10 items-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700" href={`/api/usage/diagnostics?${appliedQuery}`}>{t("下载诊断记录", "Download diagnostics")}</a>
      <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto fade-scrollbar">{events.map(event => <li key={event.id} className="py-2.5 text-xs">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="text-sm text-zinc-700">{eventLabel(event)}{event.status && <span className={`ml-2 text-xs ${event.status === 'failed' || event.failureReason ? 'text-red-500' : 'text-zinc-500'}`}>{eventStatusLabels[event.status]}</span>}</span><span className="whitespace-nowrap text-zinc-500">{formatDate(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span></div>
        {event.failureReason && <p className="mt-1 text-red-500">{localizeMessage(event.failureReason)}</p>}
        {event.code && <p className="mt-1 break-all text-zinc-500">{event.code}</p>}
        {event.durationMs !== undefined && <p className="mt-1 text-zinc-500">{t("耗时 {duration} 毫秒", "Duration: {duration} ms", { duration: formatNumber(event.durationMs) })}</p>}
      </li>)}</ul>
      {!events.length && <p className="text-sm text-zinc-500">{t("没有执行记录。", "No activity yet.")}</p>}
    </Section>

    {storage && <Section title={t("存储空间（共 {size}）", "Storage ({size} total)", { size: bytes(storage.totalBytes) })}>
      <ul className="space-y-2">{[...storage.categories, { category: 'backups', ...storage.backups }].map(item => <li key={item.category} className="flex justify-between gap-3 text-sm"><span>{categoryLabels[item.category]}<span className="ml-2 text-zinc-500">{t("{count} 个文件", "{count} files", { count: formatNumber(item.count) })}</span></span><span className="tabular-nums">{bytes(item.bytes)}</span></li>)}</ul>
      <div className="space-y-3 border-t border-zinc-100 pt-4">
        <p className="text-sm text-zinc-600">{t("以下文件未用于对话、任务或头像，可选择清理。项目文件不在清理范围内。", "These files are unused by chats, tasks, or avatars and can be deleted. Project files are excluded.")}</p>
        <div className="max-h-52 space-y-1 overflow-y-auto fade-scrollbar">{storage.cleanupCandidates.map(file => <label key={file.fileId} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm hover:bg-zinc-50"><input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={selected.includes(file.fileId)} onChange={event => setSelected(current => event.target.checked ? [...current, file.fileId] : current.filter(id => id !== file.fileId))} /><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 text-xs tabular-nums text-zinc-500">{bytes(file.size)}</span></label>)}{!storage.cleanupCandidates.length && <p className="text-sm text-zinc-500">{t("没有可清理的文件。", "No files to clean up.")}</p>}</div>
        {storage.cleanupCandidates.length > 0 && <Action danger disabled={busy || !selected.length} onClick={() => setConfirmCleanup(true)}>{t("清理选中的 {count} 个文件", "Delete {count} selected files", { count: formatNumber(selected.length) })}</Action>}
      </div>
    </Section>}
    <ConfirmModal open={confirmCleanup} onClose={() => setConfirmCleanup(false)} onConfirm={async () => { await act(async () => { const result = await apiJson('/api/usage/storage', { method: 'DELETE', body: { fileIds: selected } }); setStorage(await apiJson('/api/usage/storage')); setSelected([]); setNotice(t("已清理 {count} 个文件，释放 {size}。", "Deleted {count} files and freed {size}.", { count: formatNumber(result.deleted), size: bytes(result.bytes) })); }); setConfirmCleanup(false); }} title={t("清理文件", "Delete files")} message={t("永久删除选中的 {count} 个文件？此操作无法撤销。", "Permanently delete {count} selected files? This action is permanent.", { count: formatNumber(selected.length) })} confirmText={t("删除", "Delete")} danger />
  </div>;
}
