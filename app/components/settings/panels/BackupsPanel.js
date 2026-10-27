'use client';
import { useI18n } from '@/lib/client/i18n';
import Select from '@/app/components/common/Select';
import ConfirmModal from '@/app/components/modals/ConfirmModal';
import { useEffect, useState } from 'react';
import { apiJson, apiRequest } from '@/lib/client/apiClient';
import { Section, Field, FileInput, Action, ErrorNotice, inputClass } from '../SettingsUI';

export default function BackupsPanel() {
  const { t, formatDate, formatNumber, localizeMessage, locale } = useI18n();
  const labels = { conversations: t("对话", "Chats"), projects: t("项目", "Projects"), files: t("文件", "Files"), settings: t("个人设置", "Personal settings") };
  const weekdays = [t("星期日", "Sunday"), t("星期一", "Monday"), t("星期二", "Tuesday"), t("星期三", "Wednesday"), t("星期四", "Thursday"), t("星期五", "Friday"), t("星期六", "Saturday")];
  const listSeparator = locale === "zh" ? "、" : ", ";

  const [selection, setSelection] = useState(Object.keys(labels));
  const [password, setPassword] = useState('');
  const [jobs, setJobs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('02:00');
  const [weekday, setWeekday] = useState(0);
  const [upload, setUpload] = useState(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [preview, setPreview] = useState(null);
  const [applySettings, setApplySettings] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = async () => { const [history, plans] = await Promise.all([apiJson('/api/backups'), apiJson('/api/backups/schedules')]); setJobs(history.jobs); setSchedules(plans.schedules); };
  useEffect(() => {
    let alive = true;
    Promise.all([apiJson('/api/backups'), apiJson('/api/backups/schedules')]).then(([history, plans]) => { if (alive) { setJobs(history.jobs); setSchedules(plans.schedules); } }).catch(failure => { if (alive) setError(failure.message); });
    apiJson('/api/connections').then(data => { if (alive) setConnections(data.connections.filter(item => item.kind !== 'mcp' && item.enabled)); }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, []);
  const act = async (area, task) => { setBusy(area); setError(''); setNotice(null); try { await task(); } catch (failure) { setError(failure.message); } finally { setBusy(''); } };
  const status = area => notice?.area === area ? <p role="status" className="text-sm text-primary">{t(...notice.message)}</p> : null;
  const missingDestination = Boolean(connectionId) && !destinationPath.trim();
  const config = () => ({ selection, password, ...(connectionId ? { destination: { connectionId, path: destinationPath.trim() } } : {}) });
  const restoreForm = () => { const body = new FormData(); body.append('file', upload); body.append('password', restorePassword); return body; };
  const time24 = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-5">
    <ErrorNotice error={error} />
    <Section title={t("立即备份", "Back up now")} description={t("备份使用你设置的密码加密。请妥善保管密码，遗失后无法恢复。", "Backups are encrypted with your password. Keep it safe: you need it to restore a backup.")}>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("备份内容", "What to back up")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-3">{Object.entries(labels).map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={selection.includes(key)} onChange={event => setSelection(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))} />{label}</label>)}</div>
        <p className="max-w-prose text-xs leading-5 text-zinc-500">{t("不包含花费记录、登录状态、服务密钥、网页操作状态、连接密码和权限授权。头像需要同时勾选文件；配音偏好会保存，但不会重建服务商的自定义音色。", "Backups exclude cost records, sign-in sessions, service keys, browser sessions, connection passwords, and permissions. Include files to back up avatars. Voice preferences are saved; custom voices hosted by the provider must be set up separately.")}</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("备份密码", "Backup password")} hint={t("至少 10 个字符。", "At least 10 characters.")} type="password" autoComplete="new-password" minLength={10} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} />
        <Field label={t("保存位置", "Save to")}><Select className={inputClass} ariaLabel={t("备份保存位置", "Backup location")} value={connectionId} onChange={setConnectionId} options={[{ id: "", label: t("保存在此账户，可手动下载", "Save to this account for download") }, ...connections.map(item => ({ id: item.id, label: item.name }))]} /></Field>
      </div>
      {connectionId && <Field label={t("远端文件夹", "Remote folder")} placeholder={t("例如 backups", "For example, backups")} value={destinationPath} onChange={event => setDestinationPath(event.target.value)} />}
      <div className="flex flex-wrap items-center gap-3">
        <Action primary disabled={Boolean(busy) || !selection.length || password.length < 10 || missingDestination} onClick={() => act('backup', async () => { await apiJson('/api/backups', { method: 'POST', body: config() }); await load(); setNotice({ area: 'backup', message: ["加密备份已生成，可以在备份记录中下载。", "Encrypted backup created. Download it from your backup history."] }); })}>{busy === 'backup' ? t("正在备份…", "Backing up…") : t("立即备份", "Back up now")}</Action>
        {status('backup')}
      </div>
    </Section>

    <Section title={t("定时备份", "Scheduled backups")} description={t("按上方选择的内容、密码和保存位置备份，时间为北京时间。", "Uses the content, password, and location selected above. Times are in Beijing time (UTC+8).")}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("备份周期", "Frequency")}><Select className={`${inputClass} sm:w-36`} value={frequency} onChange={setFrequency} options={[{ id: "daily", label: t("每天", "Daily") }, { id: "weekly", label: t("每周", "Weekly") }]} /></Field>
        {frequency === 'weekly' && <Field label={t("星期", "Day")}><Select className={`${inputClass} sm:w-36`} value={weekday} onChange={value => setWeekday(Number(value))} options={weekdays.map((label, index) => ({ id: index, label }))} /></Field>}
        <Field label={t("时间", "Time")}><input className={`${inputClass} sm:w-36`} type="time" value={time} onChange={event => setTime(event.target.value)} /></Field>
        <Action disabled={Boolean(busy) || password.length < 10 || !selection.length || missingDestination || !time} onClick={() => act('schedule', async () => { const [hour, minute] = time.split(':').map(Number); await apiJson('/api/backups/schedules', { method: 'POST', body: { ...config(), frequency, hour, minute, weekday } }); await load(); setNotice({ area: 'schedule', message: ["定时备份已保存。", "Backup schedule saved."] }); })}>{t("添加定时备份", "Add schedule")}</Action>
      </div>
      {status('schedule')}
      {password.length < 10 && <p className="text-xs text-zinc-500">{t("先在上方填写备份密码，才能添加定时备份。", "Enter a backup password above before adding a schedule.")}</p>}
      {schedules.length > 0 && <ul className="divide-y divide-zinc-100 border-t border-zinc-100">{schedules.map(schedule => <li key={schedule._id} className="flex flex-wrap items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{schedule.frequency === 'daily' ? t("每天 {time}", "Daily at {time}", { time: time24(schedule.hour, schedule.minute) }) : t("每{day} {time}", "Every {day} at {time}", { day: weekdays[schedule.weekday], time: time24(schedule.hour, schedule.minute) })}</p>
          <p className="mt-1 text-xs text-zinc-500">{t("下次：{date}；内容：{items}", "Next: {date}. Includes {items}.", { date: formatDate(schedule.nextRunAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }), items: schedule.selection.map(item => labels[item]).join(listSeparator) })}</p>
          {schedule.lastError && <p className="mt-1 text-xs text-red-500">{localizeMessage(schedule.lastError)}</p>}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={schedule.enabled} onChange={event => act('schedules', async () => { await apiJson(`/api/backups/schedules/${schedule._id}`, { method: 'PATCH', body: { enabled: event.target.checked } }); await load(); })} />{t("启用", "Enabled")}</label>
        <Action danger onClick={() => setConfirm({ kind: 'schedule', id: schedule._id })}>{t("删除", "Delete")}</Action>
      </li>)}</ul>}
    </Section>

    <Section title={t("从备份恢复", "Restore from backup")} description={t("恢复的内容会作为新副本加入，原有内容保留不变。", "Restored items are added as new copies. Your existing content stays as it is.")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("加密备份文件", "Encrypted backup file")}><FileInput className={inputClass} type="file" accept=".vxb" onChange={event => { setUpload(event.target.files[0] || null); setPreview(null); setApplySettings(false); }} /></Field>
        <Field label={t("此备份的密码", "Password for this backup")} type="password" autoComplete="off" value={restorePassword} onChange={event => { setRestorePassword(event.target.value); setPreview(null); }} />
      </div>
      <Action disabled={Boolean(busy) || !upload || restorePassword.length < 10} onClick={() => act('inspect', async () => setPreview(await apiRequest('/api/backups/inspect', { method: 'POST', body: restoreForm() })))}>{busy === 'inspect' ? t("正在检查…", "Inspecting…") : t("检查备份内容", "Inspect backup")}</Action>
      {preview && <div className="space-y-3 rounded-xl bg-zinc-50 p-4">
        <p className="text-sm">{t("备份时间：{date}", "Created: {date}", { date: formatDate(preview.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
        <p className="text-sm">{Object.entries(preview.counts).filter(([, count]) => count).map(([key, count]) => t("{label} {count} 项", "{count} {label}", { label: labels[key], count: formatNumber(count) })).join(listSeparator)}</p>
        <p className="text-xs text-zinc-500">{localizeMessage(preview.restoreMode)}</p>
        {preview.includesSettings && <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={applySettings} onChange={event => setApplySettings(event.target.checked)} />{t("应用备份中的个人设置", "Apply personal settings from the backup")}</label>}
        <Action primary onClick={() => act('restore', async () => { const body = restoreForm(); body.append('digest', preview.digest); body.append('applySettings', String(applySettings)); await apiRequest('/api/backups/restore', { method: 'POST', body }); setPreview(null); await load(); setNotice({ area: 'restore', message: ["恢复完成，原有内容已保留。", "Restore complete. Your existing content has been kept."] }); })}>{busy === 'restore' ? t("正在恢复…", "Restoring…") : t("恢复为新副本", "Restore as a new copy")}</Action>
      </div>}
      {status('restore')}
    </Section>

    <Section title={t("备份与恢复记录", "Backup and restore history")}>
      <Action onClick={() => act('history', load)}>{busy === 'history' ? t("正在刷新…", "Refreshing…") : t("刷新记录", "Refresh history")}</Action>
      {jobs.length === 0 ? <p className="text-sm text-zinc-500">{t("还没有备份记录。", "No backups yet.")}</p> : <ul className="divide-y divide-zinc-100 border-t border-zinc-100">{jobs.map(job => <li key={job._id} className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">{job.type === 'restore' ? t("恢复", "Restore") : t("备份", "Backup")}<span className="ml-2 text-zinc-500">{formatDate(job.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span><span className={`mt-1 block text-xs ${job.status === 'failed' ? 'text-red-500' : 'text-zinc-500'}`}>{{ running: t("进行中", "In progress"), completed: t("已完成", "Completed"), failed: t("失败", "Failed") }[job.status]}</span></p>
          {job.type === 'backup' && job.status === 'completed' && <a className="inline-flex min-h-10 items-center rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700" href={`/api/backups/${job._id}/download`}>{t("下载", "Download")}</a>}
          <Action danger disabled={Boolean(busy) || job.status === 'running'} onClick={() => setConfirm({ kind: 'job', id: job._id })}>{t("删除记录", "Delete record")}</Action>
        </div>
        {job.error && <p className="mt-2 text-xs text-red-500">{localizeMessage(job.error)}</p>}
      </li>)}</ul>}
    </Section>
    <ConfirmModal
      open={Boolean(confirm)}
      onClose={() => setConfirm(null)}
      onConfirm={async () => { const target = confirm; await act('delete', async () => { await apiJson(target.kind === 'job' ? `/api/backups/${target.id}` : `/api/backups/schedules/${target.id}`, { method: 'DELETE' }); await load(); }); setConfirm(null); }}
      title={confirm?.kind === 'job' ? t("删除备份记录", "Delete backup record") : t("删除定时备份", "Delete schedule")}
      message={confirm?.kind === 'job' ? t("删除这条记录及对应的备份文件？此操作无法撤销。", "Delete this record and its backup file? This action is permanent.") : t("删除这个定时备份？已生成的备份会保留。", "Delete this schedule? Backups already created are kept.")}
      confirmText={t("删除", "Delete")}
      danger
    />
  </fieldset>;
}
