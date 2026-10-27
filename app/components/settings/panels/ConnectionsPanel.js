'use client';
import { useI18n } from '@/lib/client/i18n';
import Select from '@/app/components/common/Select';
import ConfirmModal from '@/app/components/modals/ConfirmModal';
import { useEffect, useRef, useState } from 'react';
import { File, Folder } from 'lucide-react';
import { apiJson } from '@/lib/client/apiClient';
import { Section, Field, Action, ErrorNotice, inputClass } from '../SettingsUI';

const request = (url, method = 'GET', body) => apiJson(url, { method, ...(body === undefined ? {} : { body }) });
const EMPTY_DRAFT = { name: '', kind: 'mcp', url: '', root: '', authType: 'apiKey', apiKey: '', username: '', password: '', accessKeyId: '', secretAccessKey: '', knownHosts: '', region: '', apiKeyHeader: 'Authorization', clientId: '', clientSecret: '' };

export default function ConnectionsPanel() {
  const { t, formatDate, formatNumber } = useI18n();
  const addressExamples = {
    mcp: t("例如 https://example.com/mcp", "For example, https://example.com/mcp"),
    webdav: t("例如 https://files.example.com/dav", "For example, https://files.example.com/dav"),
    s3: t("例如 https://s3.example.com", "For example, https://s3.example.com"),
    sftp: t("例如 sftp://files.example.com", "For example, sftp://files.example.com"),
    smb: t("例如 smb://files.example.com", "For example, smb://files.example.com"),
    ftp: t("例如 ftp://files.example.com", "For example, ftp://files.example.com"),
  };

  const [connections, setConnections] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [importText, setImportText] = useState('');
  const [files, setFiles] = useState(null);
  const [preview, setPreview] = useState('');
  const [library, setLibrary] = useState([]);
  const [writeFileId, setWriteFileId] = useState('');
  const [destination, setDestination] = useState('');
  const [writeConfirmed, setWriteConfirmed] = useState(false);
  const [oauthLinks, setOauthLinks] = useState({});
  const [deleting, setDeleting] = useState(null);
  const running = useRef(false);

  const load = async () => setConnections((await request('/api/connections')).connections);
  useEffect(() => {
    let alive = true;
    request('/api/connections').then(data => { if (alive) setConnections(data.connections); }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, []);
  const run = async (task, message = '') => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); await load(); if (message) setNotice(message); } catch (failure) { setError(failure.message); } finally { running.current = false; setBusy(false); }
  };
  const edit = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const browse = async (id, path = '') => {
    const data = await request(`/api/connections/${id}/files?path=${encodeURIComponent(path)}`);
    setFiles({ id, path, items: data.files });
    setPreview('');
    setDestination(path ? `${path}/` : '');
    setWriteConfirmed(false);
    setLibrary((await request('/api/library')).files);
  };
  const addConnection = event => {
    event.preventDefault();
    run(async () => {
      await request('/api/connections', 'POST', {
        name: draft.name, kind: draft.kind,
        config: { url: draft.url, root: draft.root, region: draft.region, authType: draft.authType, apiKeyHeader: draft.apiKeyHeader },
        credentials: { apiKey: draft.apiKey, username: draft.username, password: draft.password, accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey, knownHosts: draft.knownHosts, ...(draft.clientId ? { clientInformation: { client_id: draft.clientId, ...(draft.clientSecret ? { client_secret: draft.clientSecret } : {}) } } : {}) },
      });
      setDraft(current => ({ ...EMPTY_DRAFT, kind: current.kind }));
    }, t("连接已添加", "Connection added"));
  };
  const importConfiguration = () => run(async () => {
    let parsed;
    try { parsed = JSON.parse(importText); } catch { throw new Error(t("配置不是有效的 JSON，请检查括号和引号。", "The configuration is not valid JSON. Check the brackets and quotes.")); }
    await request('/api/connections', 'POST', { import: parsed });
    setImportText('');
  }, t("配置已导入", "Configuration imported"));
  const deletingConnection = connections.find(item => item.id === deleting);

  return <fieldset disabled={busy} className="min-w-0 space-y-5">
    <ErrorNotice error={error} />
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    <Section title={t("添加连接", "Add connection")} description={t("连接外部工具和文件夹，选择允许助手使用的工具。调用外部工具或写回文件前会请你确认。", "Connect external tools and folders, then choose which tools your assistant can use. You will be asked to confirm before calling external tools or writing files back.")}>
      <form className="space-y-4" onSubmit={addConnection}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("连接名称", "Connection name")} value={draft.name} onChange={event => edit('name', event.target.value)} required maxLength={100} />
          <Field label={t("连接类型", "Connection type")}><Select className={inputClass} value={draft.kind} onChange={value => edit('kind', value)} options={[['mcp', t("MCP 工具", "MCP tools")], ['webdav', 'WebDAV'], ['s3', t("S3 对象存储", "S3 storage")], ['sftp', 'SFTP'], ['smb', 'SMB'], ['ftp', t("FTP（加密连接）", "FTP (encrypted)")]].map(([id, label]) => ({ id, label }))} /></Field>
        </div>
        <Field label={t("连接地址", "Connection URL")} value={draft.url} onChange={event => edit('url', event.target.value)} placeholder={addressExamples[draft.kind]} required />
        {draft.kind === 'mcp' ? <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("认证方式", "Authentication")}><Select className={inputClass} value={draft.authType} onChange={value => edit('authType', value)} options={[{ id: "apiKey", label: t("API 密钥", "API key") }, { id: "oauth", label: t("网页登录授权（OAuth）", "Sign in to authorize (OAuth)") }, { id: "none", label: t("无需认证", "No authentication") }]} /></Field>
            {draft.authType === 'apiKey' && <Field label={t("密钥类型", "API key type")}><Select className={inputClass} value={draft.apiKeyHeader} onChange={value => edit('apiKeyHeader', value)} options={[{ id: "Authorization", label: t("Bearer 密钥", "Bearer token") }, { id: "X-API-Key", label: t("X-API-Key 密钥", "X-API-Key header") }]} /></Field>}
          </div>
          {draft.authType === 'apiKey' && <Field label={t("API 密钥", "API key")} type="password" autoComplete="new-password" value={draft.apiKey} onChange={event => edit('apiKey', event.target.value)} />}
          {draft.authType === 'oauth' && <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"><summary className="cursor-pointer text-sm font-medium">{t("填写服务商提供的客户端信息（如需要）", "Enter client details from your provider, if required")}</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label={t("客户端编号（Client ID）", "Client ID")} value={draft.clientId} onChange={event => edit('clientId', event.target.value)} /><Field label={t("客户端密钥（选填）", "Client secret (optional)")} type="password" autoComplete="new-password" value={draft.clientSecret} onChange={event => edit('clientSecret', event.target.value)} /></div></details>}
        </> : <>
          <Field label={t("限定文件夹", "Allowed folder")} hint={t("S3 请填写 bucket/文件夹。", "For S3, use bucket/folder.")} value={draft.root} onChange={event => edit('root', event.target.value)} />
          {draft.kind === 's3' ? <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("访问密钥 ID", "Access key ID")} autoComplete="off" value={draft.accessKeyId} onChange={event => edit('accessKeyId', event.target.value)} />
            <Field label={t("访问密钥", "Secret access key")} type="password" autoComplete="new-password" value={draft.secretAccessKey} onChange={event => edit('secretAccessKey', event.target.value)} />
            <Field label={t("区域", "Region")} value={draft.region} onChange={event => edit('region', event.target.value)} />
          </div> : <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("用户名", "Username")} autoComplete="off" value={draft.username} onChange={event => edit('username', event.target.value)} />
            <Field label={t("密码", "Password")} type="password" autoComplete="new-password" value={draft.password} onChange={event => edit('password', event.target.value)} />
          </div>}
          {draft.kind === 'sftp' && <Field label={t("服务器公钥", "Server public key")} hint={t("从 known_hosts 中复制该服务器的记录。", "Copy this server's entry from known_hosts.")}><textarea className={inputClass} rows={3} value={draft.knownHosts} onChange={event => edit('knownHosts', event.target.value)} /></Field>}
        </>}
        <Action type="submit" primary disabled={busy || !draft.name.trim() || !draft.url.trim()}>{t("添加连接", "Add connection")}</Action>
      </form>
      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <summary className="cursor-pointer text-sm font-medium">{t("从 MCP 配置导入", "Import MCP configuration")}</summary>
        <div className="mt-3 space-y-3">
          <textarea aria-label={t("MCP 配置", "MCP configuration")} className={`${inputClass} min-h-28 font-mono text-xs`} placeholder={t("{\"mcpServers\":{\"我的工具\":{\"url\":\"https://example.com/mcp\"}}}", "{\"mcpServers\":{\"My tool\":{\"url\":\"https://example.com/mcp\"}}}")} value={importText} onChange={event => setImportText(event.target.value)} />
          <Action disabled={busy || !importText.trim()} onClick={importConfiguration}>{t("导入配置", "Import configuration")}</Action>
        </div>
      </details>
    </Section>

    {connections.map(connection => <section key={connection.id} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words font-semibold">{connection.name}</h3><p className="mt-1 break-all text-xs text-zinc-500">{connection.config.url}</p>{connection.testedAt && <p className="mt-1 text-xs text-primary">{t("最近测试成功：{date}", "Last tested: {date}", { date: formatDate(connection.testedAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>}</div>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={connection.enabled} onChange={event => run(() => request(`/api/connections/${connection.id}`, 'PATCH', { enabled: event.target.checked }))} />{t("启用", "Enabled")}</label>
      </div>
      <div className="flex flex-wrap gap-2">
        {connection.config.authType === 'oauth' && <Action onClick={() => run(async () => { const result = await request(`/api/connections/${connection.id}/oauth`, 'POST'); if (result.authorizationUrl) setOauthLinks(links => ({ ...links, [connection.id]: result.authorizationUrl })); })}>{t("网页登录授权", "Sign in to authorize")}</Action>}
        {oauthLinks[connection.id] && <a href={oauthLinks[connection.id]} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-primary/40 px-4 text-sm font-medium text-primary hover:bg-primary/10">{t("前往授权页面", "Open authorization page")}</a>}
        <Action onClick={() => run(() => request(`/api/connections/${connection.id}/test`, 'POST'), t("连接测试成功", "Connection test passed"))}>{t("测试连接", "Test connection")}</Action>
        {connection.kind !== 'mcp' && <Action onClick={() => run(() => browse(connection.id))}>{t("浏览文件", "Browse files")}</Action>}
        <Action danger onClick={() => setDeleting(connection.id)}>{t("删除", "Delete")}</Action>
      </div>
      {connection.tools?.length > 0 && <div className="divide-y divide-zinc-100 border-t border-zinc-100">{connection.tools.map(tool => <label key={tool.name} className="flex cursor-pointer gap-3 py-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={tool.enabled === true} onChange={event => run(() => request(`/api/connections/${connection.id}`, 'PATCH', { tools: [{ name: tool.name, enabled: event.target.checked }] }))} /><span className="min-w-0"><span className="block break-words font-medium">{tool.title || tool.name}</span>{tool.description && <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{tool.description}</span>}</span></label>)}</div>}
      {Boolean(connection.resources?.length || connection.prompts?.length) && <p className="text-xs text-zinc-500">{t("{resources} 份资料，{prompts} 个提示模板", "{resources} resources, {prompts} prompt templates", { resources: formatNumber(connection.resources?.length || 0), prompts: formatNumber(connection.prompts?.length || 0) })}</p>}
    </section>)}

    {files && <section className="min-w-0 space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-700">
      <div className="flex items-center justify-between gap-3"><h3 className="min-w-0 break-all font-semibold">/{files.path}</h3><Action onClick={() => setFiles(null)}>{t("关闭", "Close")}</Action></div>
      {files.path && <Action onClick={() => run(() => browse(files.id, files.path.split('/').slice(0, -1).join('/')))}>{t("上一级", "Parent folder")}</Action>}
      {files.items.length === 0 && <p className="text-sm text-zinc-500">{t("这个文件夹是空的。", "This folder is empty.")}</p>}
      <ul className="divide-y divide-zinc-100">{files.items.map(item => <li className="flex flex-wrap items-center gap-2 py-2" key={item.path}>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">{item.isDirectory ? <Folder size={16} className="shrink-0 text-primary" /> : <File size={16} className="shrink-0 text-zinc-500" />}<span className="break-all">{item.name}</span></span>
        {item.isDirectory ? <Action onClick={() => run(() => browse(files.id, item.path))}>{t("打开", "Open")}</Action> : <>
          <Action onClick={() => run(async () => setPreview((await request(`/api/connections/${files.id}/files?read=true&path=${encodeURIComponent(item.path)}`)).text))}>{t("查看文本", "View text")}</Action>
          <Action onClick={() => run(async () => { await request(`/api/connections/${files.id}/files`, 'POST', { action: 'import', path: item.path }); }, t("已导入到文件库：{name}", "Imported to your library: {name}", { name: item.name }))}>{t("导入", "Import")}</Action>
        </>}
      </li>)}</ul>
      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"><summary className="cursor-pointer text-sm font-medium">{t("将文件写回远端", "Write a file to remote storage")}</summary><div className="mt-3 space-y-3">
        <Select ariaLabel={t("选择要写回的文件", "Choose a file to write")} value={writeFileId} onChange={value => { setWriteFileId(value); setWriteConfirmed(false); }} options={[{ id: "", label: t("从文件库选择文件", "Choose a file from your library") }, ...library.map(file => ({ id: file.fileId, label: file.name }))]} />
        <Field label={t("远端完整文件路径", "Full remote file path")} value={destination} onChange={event => { setDestination(event.target.value); setWriteConfirmed(false); }} />
        <label className="flex cursor-pointer gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={writeConfirmed} onChange={event => setWriteConfirmed(event.target.checked)} />{t("我确认写入此路径，并覆盖同名文件", "I confirm writing to this path and replacing any file with the same name")}</label>
        <Action primary disabled={busy || !writeConfirmed || !writeFileId || !destination} onClick={() => run(async () => { await request(`/api/connections/${files.id}/files`, 'POST', { action: 'write', fileId: writeFileId, destinationPath: destination, confirmed: true }); await browse(files.id, files.path); }, t("文件已写回远端", "File written to remote storage"))}>{t("写回远端", "Write to remote")}</Action>
      </div></details>
      {preview && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-xs">{preview}</pre>}
    </section>}
    <ConfirmModal open={Boolean(deletingConnection)} onClose={() => setDeleting(null)} onConfirm={async () => { const id = deleting; await run(async () => { await request(`/api/connections/${id}`, 'DELETE'); if (files?.id === id) setFiles(null); }, t("连接已删除", "Connection deleted")); setDeleting(null); }} title={t("删除连接", "Delete connection")} message={t("删除“{name}”？助手将无法再使用这个连接。", "Delete “{name}”? Your assistant will no longer be able to use it.", { name: deletingConnection?.name || '' })} confirmText={t("删除", "Delete")} danger />
  </fieldset>;
}
