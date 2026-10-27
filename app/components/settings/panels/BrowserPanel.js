'use client';
import { useI18n } from '@/lib/client/i18n';
import Select from '@/app/components/common/Select';
import ConfirmModal from '@/app/components/modals/ConfirmModal';
import { apiJson } from '@/lib/client/apiClient';
import { useEffect, useRef, useState } from 'react';
import { Section, Action, ErrorNotice, inputClass } from '../SettingsUI';

export default function BrowserPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState({ tabs: [] });
  const [view, setView] = useState(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileId, setFileId] = useState('');
  const [selected, setSelected] = useState('');
  const [downloadFile, setDownloadFile] = useState(null);
  const [library, setLibrary] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const image = useRef(null);

  const load = async () => setStatus(await apiJson('/api/browser'));
  useEffect(() => {
    let alive = true;
    apiJson('/api/browser').then(data => { if (alive) setStatus(data); }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, []);

  const run = async task => {
    setBusy(true); setError('');
    try { return await task(); } catch (failure) { setError(failure.message); return null; } finally { setBusy(false); }
  };
  const action = value => run(async () => {
    const data = await apiJson('/api/browser/action', { method: 'POST', body: { tabId: view?.tabId, ...value } });
    if (value.action === 'close_tab') setView(null);
    if (data.screenshot) { setView(data); setSelected(''); }
    if (data.file) setDownloadFile(data.file);
    await load();
    return data;
  });
  const close = revoke => run(async () => {
    await apiJson(`/api/browser?revoke=${revoke}`, { method: 'DELETE' });
    setView(null);
    await load();
  });
  const clickPreview = event => {
    if (busy) return;
    const element = image.current;
    const rect = element.getBoundingClientRect();
    action({ action: 'click', x: (event.clientX - rect.left) * element.naturalWidth / rect.width, y: (event.clientY - rect.top) * element.naturalHeight / rect.height });
  };

  return <fieldset disabled={busy} className="min-w-0 space-y-5">
    <ErrorNotice error={error} />
    <Section title={t("打开网页", "Open a page")} description={t("在这里直接登录网站、输入验证码或处理验证。点击画面选择位置，再输入文字。登录状态仅保存在你的账户中；同时最多打开三个页面。", "Sign in to websites, enter verification codes, and complete checks here. Click a location in the preview, then enter text. Sign-in sessions are private to your account. You can open up to three pages at a time.")}>
      {status.busy && <p role="status" className="text-sm text-amber-700">{t("浏览器正忙，任务会排队等待。", "The browser is busy. Tasks will wait in the queue.")}</p>}
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); action({ action: 'navigate', url }); }}>
        <input type="url" aria-label={t("网址", "Website address")} placeholder={t("输入 https:// 开头的网址", "Enter a URL starting with https://")} className={`${inputClass} basis-full sm:basis-auto sm:flex-1`} value={url} onChange={event => setUrl(event.target.value)} />
        <Action type="submit" primary disabled={busy || status.busy || !url}>{t("打开", "Open")}</Action>
        <Action disabled={busy || status.busy || !url} onClick={() => action({ action: 'new_tab', url })}>{t("在新页面打开", "Open in new page")}</Action>
      </form>
      {status.tabs.length > 0 && <div role="group" aria-label={t("已打开的页面", "Open pages")} className="flex flex-wrap gap-2">{status.tabs.map(tab => <button type="button" key={tab.id} aria-pressed={view?.tabId === tab.id} className={`max-w-56 truncate rounded-lg border px-3 py-2 text-sm transition-colors ${view?.tabId === tab.id ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700'}`} onClick={() => action({ action: 'observe', tabId: tab.id })}>{tab.url === 'about:blank' ? t("空白页面", "Blank page") : tab.url}</button>)}</div>}
      {status.active && <div className="space-y-3">
        <p className="text-sm text-zinc-500">{status.manual ? t("你正在操作浏览器", "You are controlling the browser") : t("浏览器正由任务使用", "A task is using the browser")}</p>
        <div className="flex flex-wrap gap-2">
          {!status.manual && <Action onClick={() => action({ action: 'takeover' })}>{t("手动接管", "Take control")}</Action>}
          {status.manual && <Action onClick={() => action({ action: 'resume' })}>{t("交还给任务", "Return control to task")}</Action>}
          <Action onClick={() => action({ action: 'observe' })}>{t("刷新画面", "Refresh preview")}</Action>
          <Action onClick={() => action({ action: 'close_tab' })}>{t("关闭当前页面", "Close current page")}</Action>
        </div>
      </div>}
      {!status.active && <Action onClick={() => run(load)}>{t("刷新浏览器状态", "Refresh browser status")}</Action>}
    </Section>

    {view?.screenshot && <Section title={view.title || t("当前页面", "Current page")} description={view.url}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={image} src={view.screenshot} alt={t("可操作的浏览器页面", "Interactive browser preview")} className={`w-full rounded-lg border border-zinc-200 dark:border-zinc-700 ${busy ? 'opacity-60' : 'cursor-crosshair'}`} onClick={clickPreview} />
      <form className="flex flex-wrap gap-2" onSubmit={async event => { event.preventDefault(); const result = await action({ action: 'type', text }); if (result) setText(''); }}>
        <input type="password" autoComplete="off" aria-label={t("输入到网页的文字或密码", "Text or password to enter on the page")} placeholder={t("输入文字、密码或验证码", "Enter text, a password, or a verification code")} className={`${inputClass} basis-full sm:basis-auto sm:flex-1`} value={text} onChange={event => setText(event.target.value)} />
        <Action type="submit" primary disabled={busy || !text}>{t("填入网页", "Type on page")}</Action>
      </form>
      <div role="group" aria-label={t("键盘与滚动", "Keys and scrolling")} className="flex flex-wrap gap-2">
        {[['Enter', t("回车", "Press Enter")], ['Tab', t("下一个输入框", "Next field")], ['Backspace', t("退格", "Backspace")], ['Escape', t("关闭弹层", "Press Escape")]].map(([key, label]) => <Action key={key} onClick={() => action({ action: 'key', key })}>{label}</Action>)}
        <Action onClick={() => action({ action: 'scroll', amount: -600 })}>{t("向上滚动", "Scroll up")}</Action>
        <Action onClick={() => action({ action: 'scroll', amount: 600 })}>{t("向下滚动", "Scroll down")}</Action>
      </div>
      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700" onToggle={event => { if (event.currentTarget.open) apiJson('/api/library').then(data => setLibrary(data.files)).catch(failure => setError(failure.message)); }}>
        <summary className="cursor-pointer text-sm font-medium">{t("选择网页元素与传输文件", "Page elements and file transfer")}</summary>
        <div className="mt-3 space-y-3">
          <Select ariaLabel={t("网页元素", "Page element")} value={selected} onChange={setSelected} options={[
            { id: "", label: t("选择网页中的按钮、输入框或链接", "Choose a button, input, or link on the page") },
            ...(view.elements || []).map(element => ({ id: String(element.element), label: `${element.element}. ${element.label || element.text || element.placeholder || element.type || t("未命名元素", "Unnamed element")}` })),
          ]} />
          <Select ariaLabel={t("选择要上传的文件", "Choose a file to upload")} value={fileId} onChange={setFileId} options={[
            { id: "", label: t("从文件库选择文件", "Choose a file from your library") },
            ...library.map(file => ({ id: file.fileId, label: file.name })),
          ]} />
          <div className="flex flex-wrap gap-2">
            <Action disabled={busy || selected === ''} onClick={() => action({ action: 'click', element: Number(selected) })}>{t("点击选定元素", "Click selected element")}</Action>
            <Action disabled={busy || selected === '' || !fileId} onClick={() => action({ action: 'upload', element: Number(selected), fileId })}>{t("上传选定文件", "Upload selected file")}</Action>
            <Action disabled={busy || selected === ''} onClick={() => action({ action: 'download', element: Number(selected) })}>{t("从网页下载文件", "Download from page")}</Action>
          </div>
        </div>
      </details>
      {downloadFile && <a className="inline-block break-all text-sm text-primary underline" href={downloadFile.url} download={downloadFile.name}>{t("下载：{name}", "Download: {name}", { name: downloadFile.name })}</a>}
    </Section>}

    <Section title={t("关闭浏览器", "Close the browser")} description={t("保留登录状态后，下次打开网站仍保持登录；清除后需要重新登录。", "Keep sign-in sessions to stay signed in next time, or clear them to sign out of every site.")}>
      <div className="flex flex-wrap gap-2">
        <Action onClick={() => close(false)}>{t("关闭并保留登录状态", "Close and keep sign-in sessions")}</Action>
        <Action danger onClick={() => setConfirmClear(true)}>{t("关闭并清除登录状态", "Close and clear sign-in sessions")}</Action>
      </div>
    </Section>
    <ConfirmModal open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={async () => { await close(true); setConfirmClear(false); }} title={t("清除登录状态", "Clear sign-in sessions")} message={t("关闭浏览器并删除所有网站的登录状态？之后需要重新登录。", "Close the browser and delete sign-in sessions for every site? You will need to sign in again.")} confirmText={t("清除并关闭", "Clear and close")} danger />
  </fieldset>;
}
