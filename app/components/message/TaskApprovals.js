'use client';
import {useEffect,useState} from 'react';
const fieldLabels = new Map(Object.entries({
 url: '网址', title: '标题', text: '文字内容', content: '内容', message: '消息', body: '正文',
 subject: '主题', name: '名称', path: '文件路径', destination: '目标位置', to: '收件人',
 email: '邮箱', recipient: '收件人', recipients: '收件人', cc: '抄送', bcc: '密送',
 fileId: '文件编号', tabId: '页面编号', element: '页面元素编号', action: '操作',
 reviewPage: '待操作网页', target: '操作对象', fields: '网页表单内容', label: '名称',
 placeholder: '输入提示', type: '类型', value: '填写内容', checked: '是否选中', href: '链接地址',
}));
const browserActions = { navigate: '打开网页', new_tab: '打开新页面', click: '点击网页内容', fill: '填写网页内容', upload: '上传文件到网页', download: '从网页下载文件' };
function ReviewValue({value}) {
 if (value === null) return <span className="text-slate-400">未填写</span>;
 if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
 if (Array.isArray(value)) return <ol className="list-decimal space-y-2 pl-4">{value.map((entry,index)=><li key={index}><ReviewValue value={entry}/></li>)}</ol>;
 if (typeof value === 'object') return <dl className="space-y-2">{Object.entries(value).map(([key,entry])=><div key={key}><dt className="text-slate-500">{fieldLabels.has(key) ? fieldLabels.get(key) : key}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words"><ReviewValue value={entry}/></dd></div>)}</dl>;
 return <span>{String(value)}</span>;
}
function ApprovalDetails({item}) {
 const args=item.arguments;
 const isBrowser=item.tool==='浏览器操作';
 const isFileWrite=item.tool.startsWith('写回 ') && args.action==='write';
 const details=Object.fromEntries(Object.entries(args).filter(([key])=>key!=='reviewFile').map(([key,value])=>[
  key, key==='action' && isBrowser ? browserActions[value] : key==='action' && isFileWrite ? '上传文件并覆盖目标位置的同名文件' : value,
 ]));
 return <div className="mt-3 space-y-3 text-sm">
  {isBrowser && <p>允许后将{browserActions[args.action]}，请核对网址、操作对象和填写内容。</p>}
  {isFileWrite && <p>允许后将上传下方文件到指定路径，并覆盖同名文件。</p>}
  {!isBrowser && !isFileWrite && <p>允许后将向“{item.tool}”提交以下内容并执行操作。</p>}
  {args.reviewFile && <a href={args.reviewFile.url} className="inline-block text-blue-600 underline" download={args.reviewFile.name}>查看待提交文件：{args.reviewFile.name}（{Math.ceil(args.reviewFile.size/1024)} KB）</a>}
  <div className="max-h-72 overflow-auto rounded-lg bg-white/60 p-3 text-xs dark:bg-slate-900/40"><ReviewValue value={details}/></div>
 </div>;
}
export default function TaskApprovals({taskId,onChanged}){
 const [items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
 useEffect(()=>{if(!taskId)return;let alive=true;const load=async()=>{try{const r=await fetch(`/api/tasks/${taskId}/approvals`);const data=await r.json();if(alive&&r.ok)setItems(data.approvals);}catch{}};load();const timer=setInterval(load,1500);return()=>{alive=false;clearInterval(timer);};},[taskId]);
 const decide=async(id,decision)=>{setBusy(id);setError('');try{const r=await fetch(`/api/tasks/${taskId}/approvals/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});const data=await r.json();if(!r.ok)throw new Error(data.error);setItems(values=>values.map(x=>x._id===id?data.approval:x));onChanged?.();}catch(e){setError(e.message);}finally{setBusy('');}};
 const pending=items.filter(x=>x.status==='pending');if(!pending.length&&!error)return null;
 return <div className="my-3 space-y-3">{error&&<p role="alert" className="text-sm text-red-500">{error}</p>}{pending.map(item=><div key={item._id} className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4"><p className="font-medium text-sm">需要你确认：{item.tool}</p><p className="mt-1 text-xs text-slate-500">请在请求发起后 5 分钟内确认，本次授权仅执行一次。</p><ApprovalDetails item={item}/><div className="mt-3 flex gap-2"><button disabled={busy===item._id} onClick={()=>decide(item._id,'approved')} className="rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white px-4 py-2 text-sm">允许这一次</button><button disabled={busy===item._id} onClick={()=>decide(item._id,'rejected')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">拒绝</button></div></div>)}</div>;
}
