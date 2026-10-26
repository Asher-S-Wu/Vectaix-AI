'use client';
import {useEffect,useState} from 'react';
import {useI18n} from '@/lib/client/i18n';
import {apiJson} from '@/lib/client/apiClient';
function ReviewValue({value}) {
 const {t} = useI18n();
const fieldLabels = new Map(Object.entries({
 url: t("网址", "URL"), title: t("标题", "Title"), text: t("文字内容", "Text"), content: t("内容", "Content"), message: t("消息", "Message"), body: t("正文", "Body"),
 subject: t("主题", "Subject"), name: t("名称", "Name"), path: t("文件路径", "File path"), destination: t("目标位置", "Destination"), to: t("收件人", "Recipient"),
 email: t("邮箱", "Email"), recipient: t("收件人", "Recipient"), recipients: t("收件人", "Recipient"), cc: t("抄送", "Cc"), bcc: t("密送", "Bcc"),
 fileId: t("文件编号", "File ID"), tabId: t("页面编号", "Tab ID"), element: t("页面元素编号", "Element ID"), action: t("操作", "Action"),
 reviewPage: t("待操作网页", "Page to review"), target: t("操作对象", "Target"), fields: t("网页表单内容", "Form fields"), label: t("名称", "Name"),
 placeholder: t("输入提示", "Placeholder"), type: t("类型", "Type"), value: t("填写内容", "Value"), checked: t("是否选中", "Checked"), href: t("链接地址", "Link URL"),
}));

 if (value === null) return <span className="text-slate-400">{t("未填写", "Not provided")}</span>;
 if (typeof value === 'boolean') return <span>{value ? t("是", "Yes") : t("否", "No")}</span>;
 if (Array.isArray(value)) return <ol className="list-decimal space-y-2 pl-4">{value.map((entry,index)=><li key={index}><ReviewValue value={entry}/></li>)}</ol>;
 if (typeof value === 'object') return <dl className="space-y-2">{Object.entries(value).map(([key,entry])=><div key={key}><dt className="text-slate-500">{fieldLabels.has(key) ? fieldLabels.get(key) : key}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words"><ReviewValue value={entry}/></dd></div>)}</dl>;
 return <span>{String(value)}</span>;
}
function ApprovalDetails({item}) {
 const {t,formatNumber,localizeMessage} = useI18n();
const browserActions = { navigate: t("打开网页", "Open a web page"), new_tab: t("打开新页面", "Open a new tab"), click: t("点击网页内容", "Click a page element"), fill: t("填写网页内容", "Fill in a form"), upload: t("上传文件到网页", "Upload a file to the page"), download: t("从网页下载文件", "Download a file from the page") };

 const args=item.arguments;
 const isBrowser=item.tool==='浏览器操作';
 const isFileWrite=item.tool.startsWith('写回 ') && args.action==='write';
 const details=Object.fromEntries(Object.entries(args).filter(([key])=>key!=='reviewFile').map(([key,value])=>[
  key, key==='action' && isBrowser ? browserActions[value] : key==='action' && isFileWrite ? t("上传文件并覆盖目标位置的同名文件", "Upload the file and replace any file with the same name at the destination") : value,
 ]));
 return <div className="mt-3 space-y-3 text-sm">
  {isBrowser && <p>{t("即将执行：{action}。请核对网址、操作对象和填写内容。", "Action: {action}. Review the URL, target, and form contents before approving.", {action: browserActions[args.action]})}</p>}
  {isFileWrite && <p>{t("允许后将上传下方文件到指定路径，并覆盖同名文件。", "Approval will upload the file below to the specified path and replace any file with the same name.")}</p>}
  {!isBrowser && !isFileWrite && <p>{t("允许后将向“{tool}”提交以下内容并执行操作。", "Approval will submit the following content to “{tool}” and run the action.", {tool: localizeMessage(item.tool)})}</p>}
  {args.reviewFile && <a href={args.reviewFile.url} className="inline-block text-blue-600 underline" download={args.reviewFile.name}>{t("查看待提交文件：{name}（{size} KB）", "Review file: {name} ({size} KB)", {name: args.reviewFile.name, size: formatNumber(Math.ceil(args.reviewFile.size/1024))})}</a>}
  <div className="max-h-72 overflow-auto rounded-lg bg-white/60 p-3 text-xs dark:bg-slate-900/40"><ReviewValue value={details}/></div>
 </div>;
}
export default function TaskApprovals({taskId,onChanged}) {
 const {t,localizeMessage} = useI18n();
 const [items,setItems] = useState([]);
 const [loadError,setLoadError] = useState('');
 const [error,setError] = useState('');
 const [busy,setBusy] = useState('');
 const [revision,setRevision] = useState(0);
 useEffect(() => {
  if (!taskId) return;
  const controller = new AbortController();
  let timer;
  const load = async () => {
   try {
    const data = await apiJson(`/api/tasks/${taskId}/approvals`, {signal:controller.signal});
    if (controller.signal.aborted) return;
    setItems(data.approvals);
    setLoadError('');
    timer = setTimeout(load,1500);
   } catch (failure) { if (!controller.signal.aborted) setLoadError(failure.message); }
  };
  void load();
  return () => { controller.abort(); clearTimeout(timer); };
 },[taskId,revision]);
 const decide = async (id,decision) => {
  if (busy) return;
  setBusy(id); setError('');
  try {
   const data = await apiJson(`/api/tasks/${taskId}/approvals/${id}`, {method:'POST',body:{decision}});
   setItems(values => values.map(item => item._id === id ? data.approval : item));
   onChanged?.();
  } catch(failure) { setError(failure.message); }
  finally { setBusy(''); }
 };
 const pending = items.filter(item => item.status === 'pending');
 if (!pending.length && !error && !loadError) return null;
 return <div className="my-3 space-y-3">
  {loadError && <div className="space-y-2"><p role="alert" className="text-sm text-red-500">{localizeMessage(loadError)}</p><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setRevision(value => value + 1)}>{t("重新加载确认请求", "Reload approval request")}</button></div>}
  {error && <p role="alert" className="text-sm text-red-500">{localizeMessage(error)}</p>}
  {pending.map(item => <div key={item._id} className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4">
   <p className="font-medium text-sm">{t("需要你确认：{tool}", "Approval needed: {tool}", {tool:localizeMessage(item.tool)})}</p>
   <p className="mt-1 text-xs text-slate-500">{t("请在请求发起后 5 分钟内确认，本次授权仅执行一次。", "Respond within 5 minutes of the request. Approval applies to this action once.")}</p>
   <ApprovalDetails item={item}/>
   <div className="mt-3 flex gap-2"><button disabled={Boolean(busy) || Boolean(loadError)} onClick={() => decide(item._id,'approved')} className="rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50">{t("允许这一次", "Allow once")}</button><button disabled={Boolean(busy) || Boolean(loadError)} onClick={() => decide(item._id,'rejected')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">{t("拒绝", "Decline")}</button></div>
  </div>)}
 </div>;
}
