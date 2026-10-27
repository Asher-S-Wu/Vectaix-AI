'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/client/i18n';
import { AdminField, AdminNotice, adminRequest } from './AdminUI';

export default function SandboxPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testOutput, setTestOutput] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    adminRequest('/api/admin/sandbox', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setConfig(data.config);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  const changed = () => { setDirty(true); setNotice(''); setTestOutput(''); };
  const update = (key, value) => { changed(); setConfig(current => ({ ...current, [key]: value })); };
  const run = async (name, action) => {
    setBusy(name); setError(''); setNotice(''); setTestOutput('');
    try { await action(); } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  };
  const save = event => {
    event.preventDefault();
    run('save', async () => {
      const result = await adminRequest('/api/admin/sandbox', { method: 'PUT', body: {
        enabled: config.enabled, environmentId: config.environmentId, timeoutSeconds: config.timeoutSeconds,
        cpu: config.cpu, memoryGB: config.memoryGB, setupCommand: config.setupCommand,
        ...(apiKey ? { apiKey } : {}), clearApiKey,
      } });
      setConfig(result.config); setApiKey(''); setClearApiKey(false); setDirty(false);
      setNotice(['沙盒设置已保存，对所有用户的新任务生效。', 'Sandbox settings saved. They apply to new tasks for all users.']);
    });
  };
  const testConnection = () => run('test', async () => {
    const result = await adminRequest('/api/admin/sandbox', { method: 'POST' });
    setTestOutput(result.output);
    setNotice(['连接正常，Python 测试已完成。', 'Connected. The Python test completed.']);
  });

  return <>
    <header className="admin-page-heading">
      <h1>{t('云端沙盒', 'Cloud sandbox')}</h1>
      <p>{t('让花卷在 Railway 执行 Python 和技能脚本，将结果文件交付到对话。', 'Let Huajuan run Python and skill scripts on Railway and deliver files in the chat.')}</p>
    </header>
    <AdminNotice error={error} notice={notice} />
    {!config ? (error ? <button type="button" className="admin-button" onClick={() => window.location.reload()}>{t('重新加载', 'Reload')}</button> : <p role="status" className="py-10 text-sm text-zinc-500">{t('正在读取沙盒配置…', 'Loading sandbox settings…')}</p>) : <form onSubmit={save} className="admin-form">
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-6">
        <section className="admin-section">
          <div className="admin-section-title"><h2>{t('Railway 原生沙盒', 'Railway Sandboxes')}</h2><p>{t('每个任务创建独立环境，结束后回收，使用 Railway 的计算资源。', 'Each task gets its own environment on Railway, which is removed when the task ends.')}</p></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={config.enabled} disabled={clearApiKey} onChange={event => update('enabled', event.target.checked)} />{t('启用云端执行', 'Enable cloud execution')}</label>
          <div className="admin-field-grid mt-5">
            <AdminField label={t('Railway 环境 ID', 'Railway environment ID')} value={config.environmentId} required={config.enabled} placeholder="00000000-0000-0000-0000-000000000000" hint={t('填写用于创建沙盒的 Railway 项目环境 ID。', 'Enter the Railway project environment ID where sandboxes will be created.')} onChange={event => update('environmentId', event.target.value)} />
            <AdminField label="Railway API Token" type="password" autoComplete="new-password" value={apiKey} disabled={clearApiKey} placeholder={config.hasApiKey ? t('已保存密钥', 'Token saved') : t('填写 Railway API Token', 'Enter a Railway API token')} hint={config.hasApiKey ? t('密钥加密保存在服务器。留空保留现有密钥。', 'The token is encrypted on the server. Leave blank to keep it.') : t('使用有权限访问该环境的 Railway API Token。', 'Use a Railway API token with access to this environment.')} onChange={event => { changed(); setApiKey(event.target.value); }} />
          </div>
          {config.hasApiKey && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={clearApiKey} onChange={event => { changed(); setClearApiKey(event.target.checked); if (event.target.checked) { setApiKey(''); setConfig(current => ({ ...current, enabled: false })); } }} />{t('保存时删除密钥并停用沙盒', 'Delete the key and disable the sandbox on save')}</label>}
        </section>
        <section className="admin-section">
          <div className="admin-section-title"><h2>{t('运行资源', 'Runtime resources')}</h2><p>{t('为每个沙盒设置计算资源和单次命令执行时限。', 'Set computing resources for each sandbox and a time limit for each command.')}</p></div>
          <div className="admin-field-grid three">
            <AdminField label={t('CPU（vCPU）', 'CPU (vCPU)')} type="number" min="0.5" max="4" step="0.5" value={config.cpu} required onChange={event => update('cpu', (event.target.value === '' ? '' : Number(event.target.value)))} />
            <AdminField label={t('内存（GB）', 'Memory (GB)')} type="number" min="0.5" max="8" step="0.5" value={config.memoryGB} required onChange={event => update('memoryGB', (event.target.value === '' ? '' : Number(event.target.value)))} />
            <AdminField label={t('单次执行时限（秒）', 'Execution time limit (seconds)')} type="number" min="10" max="300" step="1" value={config.timeoutSeconds} required onChange={event => update('timeoutSeconds', (event.target.value === '' ? '' : Number(event.target.value)))} hint={t('可设置为 10 至 300 秒。', 'Choose between 10 and 300 seconds.')} />
          </div>
          <AdminField label={t('初始化命令（可选）', 'Setup command (optional)')} hint={t('在准备环境时运行，用于安装额外依赖。Python 和常用数据、文档处理库已预装。', 'Runs while preparing the environment to install extra dependencies. Python and common data and document libraries are preinstalled.')}><textarea className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--primary-ring)]" rows={4} maxLength={8000} value={config.setupCommand} onChange={event => update('setupCommand', event.target.value)} spellCheck={false} /></AdminField>
        </section>
        <div className="admin-form-actions flex-wrap">
          <button type="submit" className="admin-button primary">{busy === 'save' ? t('正在保存…', 'Saving…') : t('保存沙盒设置', 'Save sandbox settings')}</button>
          <button type="button" className="admin-button" disabled={dirty || !config.enabled || !config.hasApiKey} onClick={testConnection}>{busy === 'test' ? t('正在运行测试…', 'Running test…') : t('测试 Python 执行', 'Test Python execution')}</button>
          {dirty && <span className="text-xs text-zinc-500">{t('保存设置后可运行测试。', 'Save your settings before running the test.')}</span>}
        </div>
      </fieldset>
      {testOutput && <pre className="overflow-x-auto rounded-xl bg-zinc-100 p-4 text-sm" aria-label={t('Python 测试结果', 'Python test output')}>{testOutput}</pre>}
    </form>}
  </>;
}
