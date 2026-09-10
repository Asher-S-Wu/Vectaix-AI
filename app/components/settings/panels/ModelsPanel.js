'use client';
import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, PlugZap, CheckCircle2, Cpu, Server } from 'lucide-react';
import { apiJson } from '@/lib/client/apiClient';
import { loadModels } from '@/lib/client/models/useModels';
import { Action, ErrorNotice, Field, Section, Toggle, inputClass } from '../SettingsUI';

const protocols=[['chat-completions','OpenAI Chat Completions'],['responses','OpenAI Responses'],['anthropic','Anthropic Messages'],['gemini','Google Gemini']];
const newProvider={id:'',name:'',baseUrl:'',protocol:'chat-completions',enabled:true,apiKey:''};
const newModel={id:'',name:'',providerId:'',upstreamModel:'',group:'自定义',enabled:true,isDefault:false,isTranscriptionDefault:false,sortOrder:0,contextWindow:128000,maxOutputTokens:8192,nativeInputs:['text'],supportsTools:true,supportsWebSearch:true,billingMode:'tokens',pricing:{inputPerMillion:0,outputPerMillion:0,cachedInputPerMillion:0,cacheWritePerMillion:0},requestOptions:{}};
export default function ModelsPanel() {
  const [data,setData]=useState(null);
  const [tab,setTab]=useState('models');
  const [edit,setEdit]=useState(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [optionsText,setOptionsText]=useState('{}');
  async function reload() { const [models,providers]=await Promise.all([apiJson('/api/admin/models'),apiJson('/api/admin/providers')]);setData({models:models.models,providers:providers.providers}); }
  useEffect(()=>{
    let active=true;
    Promise.all([apiJson('/api/admin/models'),apiJson('/api/admin/providers')]).then(([models,providers])=>{if(active)setData({models:models.models,providers:providers.providers});}).catch(error=>{if(active)setError(error.message);});
    return ()=>{active=false;};
  },[]);
  async function run(action) { setBusy(true);setError('');setNotice('');try {await action();} catch(error){setError(error.message);} finally{setBusy(false);} }
  function start(item) {
    const value=structuredClone(item || (tab==='models'?newModel:newProvider));
    if(tab==='models')setOptionsText(JSON.stringify(value.requestOptions,null,2));
    else value.apiKey='';
    setEdit({isNew:!item,value});setError('');setNotice('');
  }
  function patch(key,value) { setEdit(current=>({...current,value:{...current.value,[key]:value}})); }
  async function save(event) { event.preventDefault();await run(async()=>{
    const value={...edit.value};
    if(tab==='models') { try{value.requestOptions=JSON.parse(optionsText);}catch{throw new Error('高级参数格式不正确，请填写有效的 JSON 对象');} }
    await apiJson(`/api/admin/${tab}${edit.isNew?'':`/${encodeURIComponent(value.id)}`}`,{method:edit.isNew?'POST':'PATCH',body:value});
    setEdit(null);await reload();await loadModels();setNotice('设置已保存');
  }); }
  async function remove(item) { await run(async()=>{await apiJson(`/api/admin/${tab}/${encodeURIComponent(item.id)}`,{method:'DELETE'});await reload();await loadModels();setNotice('已删除');}); }
  async function test(item) { await run(async()=>{
    const modelId=tab==='models'?item.id:data.models.find(model=>model.providerId===item.id&&model.enabled)?.id;
    if(!modelId)throw new Error('请先为此服务商添加并启用一个模型');
    const result=await apiJson(`/api/admin/${tab}/${encodeURIComponent(item.id)}/test`,{method:'POST',body:tab==='providers'?{modelId}:undefined});
    setNotice(`连接成功 · ${(result.durationMs/1000).toFixed(1)} 秒 · ${result.text}`);
  }); }
  const value=edit?.value;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">{[['models','模型',Cpu],['providers','服务商',Server]].map(([id,label,Icon])=><button key={id} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${tab===id?'bg-primary/10 font-medium text-primary':'text-zinc-500'}`} onClick={()=>{setTab(id);setEdit(null);}}><Icon size={16}/>{label}</button>)}</div><Action onClick={()=>start()} disabled={busy||!data}><Plus size={16}/>添加{tab==='models'?'模型':'服务商'}</Action></div>
    <ErrorNotice error={error}/>{notice&&<p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 size={18} className="shrink-0"/>{notice}</p>}
    {!data&&!error&&<p className="py-12 text-center text-sm text-zinc-500">正在读取模型设置…</p>}
    {edit&&<Section title={`${edit.isNew?'添加':'编辑'}${tab==='models'?'模型':'服务商'}`} description={tab==='providers'?'填写服务商提供的接口根地址和密钥。已保存的密钥不会显示。':'模型标识用于保存对话记录，创建后不可修改。价格以每百万个词元的美元费用填写。'}><form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="名称" required value={value.name} onChange={event=>patch('name',event.target.value)}/><Field label="标识" required disabled={!edit.isNew} value={value.id} onChange={event=>patch('id',event.target.value)}/></div>
      {tab==='providers'?<>
        <Field label="接口协议"><select className={inputClass} value={value.protocol} onChange={event=>patch('protocol',event.target.value)}>{protocols.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="接口根地址" hint="例如：https://api.openai.com/v1；无需填写 /chat/completions 等具体接口路径。" type="url" required value={value.baseUrl} placeholder="https://" onChange={event=>patch('baseUrl',event.target.value)}/>
        <Field label="服务商密钥" type="password" autoComplete="new-password" value={value.apiKey} placeholder={value.hasKey?'已保存，输入新密钥可替换':'请输入密钥'} onChange={event=>patch('apiKey',event.target.value)}/>
        <Toggle label="启用服务商" description="停用后，此服务商下的全部模型将停止接受新请求。" checked={value.enabled} onChange={checked=>patch('enabled',checked)}/>
      </>:<>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="服务商"><select required className={inputClass} value={value.providerId} onChange={event=>patch('providerId',event.target.value)}><option value="">请选择</option>{data.providers.map(provider=><option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field><Field label="上游模型名称" required value={value.upstreamModel} onChange={event=>patch('upstreamModel',event.target.value)}/><Field label="分组名称" required value={value.group} onChange={event=>patch('group',event.target.value)}/><Field label="排序" type="number" required value={value.sortOrder} onChange={event=>patch('sortOrder',Number(event.target.value))}/><Field label="上下文长度" type="number" min="512" required value={value.contextWindow} onChange={event=>patch('contextWindow',Number(event.target.value))}/><Field label="最大输出长度" type="number" min="1" required value={value.maxOutputTokens} onChange={event=>patch('maxOutputTokens',Number(event.target.value))}/></div>
        <fieldset className="space-y-3"><legend className="text-sm font-medium">支持的输入</legend><div className="flex flex-wrap gap-5">{[['text','文字'],['image','图片'],['audio','音频'],['video','视频']].map(([id,label])=><label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={id==='text'} checked={value.nativeInputs.includes(id)} className="accent-primary" onChange={event=>patch('nativeInputs',event.target.checked?[...value.nativeInputs,id]:value.nativeInputs.filter(type=>type!==id))}/>{label}</label>)}</div></fieldset>
        <div className="grid gap-x-8 sm:grid-cols-2"><Toggle label="启用模型" checked={value.enabled} onChange={checked=>patch('enabled',checked)}/><Toggle label="作为新对话默认模型" checked={value.isDefault} onChange={checked=>patch('isDefault',checked)}/><Toggle label="支持工具调用" checked={value.supportsTools} onChange={checked=>patch('supportsTools',checked)}/><Toggle label="支持联网搜索" checked={value.supportsWebSearch} onChange={checked=>patch('supportsWebSearch',checked)}/><Toggle label="作为默认语音转写模型" description="需要支持音频输入。" checked={value.isTranscriptionDefault} onChange={checked=>patch('isTranscriptionDefault',checked)}/></div>
        <Field label="计费方式"><select className={inputClass} value={value.billingMode} onChange={event=>patch('billingMode',event.target.value)}><option value="tokens">按输入与输出用量计算</option><option value="upstream-cost">使用服务商返回的实际美元费用</option></select></Field>
        <div className="grid gap-4 sm:grid-cols-2">{[['inputPerMillion','输入价格'],['outputPerMillion','输出价格'],['cachedInputPerMillion','缓存读取价格'],['cacheWritePerMillion','缓存写入价格']].map(([key,label])=><Field key={key} label={`${label}（美元 / 百万词元）`} type="number" min="0" step="any" required value={value.pricing[key]} onChange={event=>patch('pricing',{...value.pricing,[key]:Number(event.target.value)})}/>)}</div>
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><summary className="cursor-pointer text-sm font-medium">长上下文价格与高级参数</summary><div className="mt-4 space-y-4"><Toggle label="启用长上下文加价" checked={value.pricing.longContextThreshold!==undefined} onChange={checked=>{const pricing={...value.pricing};if(checked)Object.assign(pricing,{longContextThreshold:200000,longInputMultiplier:2,longOutputMultiplier:2});else for(const key of ['longContextThreshold','longInputMultiplier','longOutputMultiplier'])delete pricing[key];patch('pricing',pricing);}}/>{value.pricing.longContextThreshold!==undefined&&<div className="grid gap-3 sm:grid-cols-3">{[['longContextThreshold','输入词元阈值'],['longInputMultiplier','输入价格倍率'],['longOutputMultiplier','输出价格倍率']].map(([key,label])=><Field key={key} label={label} type="number" min="1" step={key==='longContextThreshold'?'1':'any'} value={value.pricing[key]} onChange={event=>patch('pricing',{...value.pricing,[key]:Number(event.target.value)})}/>)}</div>}<Field label="额外请求参数" hint="仅填写服务商支持的思考、缓存及输出样式参数。"><textarea rows={6} className={`${inputClass} font-mono text-xs`} value={optionsText} onChange={event=>setOptionsText(event.target.value)}/></Field></div></details>
      </>}
      <div className="flex gap-3"><Action type="submit" primary disabled={busy}>保存</Action><Action onClick={()=>setEdit(null)} disabled={busy}>取消</Action></div>
    </form></Section>}
    {data&&<Section title={tab==='models'?`已配置 ${data.models.length} 个模型`:`已配置 ${data.providers.length} 个服务商`} description={tab==='models'?'停用模型会保留已有对话记录。修改价格后，新请求按新价格结算。':'连接测试会发送一条简短请求，并产生服务商费用。'}><div className="divide-y divide-zinc-100 dark:divide-zinc-800">{data[tab].map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{item.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${item.enabled?'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400':'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>{item.enabled?'已启用':'已停用'}</span>{item.isDefault&&<span className="text-xs text-primary">默认对话</span>}{item.isTranscriptionDefault&&<span className="text-xs text-primary">默认转写</span>}</div><p className="mt-1 break-all text-xs text-zinc-500">{tab==='models'?`${item.group} · ${item.upstreamModel}`:`${protocols.find(protocol=>protocol[0]===item.protocol)?.[1]} · ${item.hasKey?'已设置密钥':'未设置密钥'}`}</p></div><div className="flex gap-2"><Action onClick={()=>test(item)} disabled={busy||!item.enabled} aria-label={`测试${item.name}`} className="!px-3"><PlugZap size={15}/><span className="hidden sm:inline">测试</span></Action><Action onClick={()=>start(item)} disabled={busy} aria-label={`编辑${item.name}`} className="!px-3"><Pencil size={15}/></Action><Action danger onClick={()=>remove(item)} disabled={busy} aria-label={`删除${item.name}`} className="!px-3"><Trash2 size={15}/></Action></div></div>)}{!data[tab].length&&<p className="py-8 text-center text-sm text-zinc-500">尚未添加{tab==='models'?'模型':'服务商'}</p>}</div></Section>}
  </div>;
}
