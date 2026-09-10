import crypto from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import BrowserSession from '@/models/BrowserSession';
import { encryptSecret,decryptSecret } from '../security/secrets.mjs';
import { assertPublicUrl } from '../security/publicUrl.mjs';
import { createStoredFile,serializeStoredFile,findOwnedStoredFile,getStoredFileAbsolutePath,deleteStoredFileDocument } from '../storage/service';
import {registerIntegrationFile} from '../integrations/artifacts';
import { startPublicProxy } from './proxy';
const runtime=globalThis.__vectaixBrowser ||= {browser:null,proxy:null,active:null,queue:[],opening:null};
async function engine(){
 if(runtime.browser?.isConnected())return runtime.browser;
 if(!runtime.opening)runtime.opening=(async()=>{const {chromium}=await import('playwright-chromium');runtime.proxy=await startPublicProxy();try{runtime.browser=await chromium.launch({headless:true,proxy:{server:runtime.proxy.url,bypass:'<-loopback>'},args:['--disable-dev-shm-usage','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});return runtime.browser;}catch(error){await runtime.proxy.close();throw error;}})().finally(()=>{runtime.opening=null;});
 return runtime.opening;
}
async function openSession(userId,taskId){
 const browser=await engine();const saved=await BrowserSession.findOne({userId}).select('+storageState').lean();
 const context=await browser.newContext({viewport:{width:1080,height:760},acceptDownloads:true,serviceWorkers:'block',...(saved?.storageState?{storageState:decryptSecret(saved.storageState,`browser:${userId}`)}:{})});
 const session={userId:String(userId),taskId:taskId?String(taskId):null,context,pages:new Map(),elements:new Map(),lastUsed:Date.now(),manual:!taskId,justOpened:true};runtime.active=session;
 await context.route('**/*',async route=>{try{await assertPublicUrl(route.request().url());await route.continue();}catch{await route.abort();}});
 context.on('page',page=>{if(session.pages.size>=3){void page.close();return;}const id=crypto.randomUUID();session.pages.set(id,page);page.on('close',()=>{session.pages.delete(id);session.elements.delete(id);});page.setDefaultTimeout(10000);});
 await context.newPage();return session;
}
export async function acquireBrowser(userId,taskId,signal){
 userId=String(userId);taskId=taskId?String(taskId):null;
 if(runtime.active?.userId===userId && !runtime.active.closing && (runtime.active.taskId===taskId || !taskId || (!runtime.queue.length&&!runtime.active.taskId&&!runtime.active.manual))){runtime.active.lastUsed=Date.now();if(taskId&&!runtime.active.taskId)runtime.active.taskId=taskId;return runtime.active;}
 const ticket={id:crypto.randomUUID(),userId,taskId};runtime.queue.push(ticket);const started=Date.now();
 try{
  while(runtime.queue[0]!==ticket || runtime.active){if(runtime.queue[0]===ticket&&runtime.active?.userId===userId&&!runtime.active.taskId&&!runtime.active.manual){runtime.active.taskId=taskId;return runtime.active;}if(signal?.aborted||ticket.cancelled)throw new Error('任务已停止');if(Date.now()-started>300000)throw new Error('浏览器排队超时，请稍后重试');await delay(500,undefined,{signal});}
  if(ticket.cancelled||signal?.aborted)throw new Error('任务已停止');
  // Reserve before async browser startup so another caller cannot take the slot.
  runtime.active={userId,taskId,opening:true,lastUsed:Date.now()};
  runtime.sessionOpening=openSession(userId,taskId);
  try{return await runtime.sessionOpening;}catch(error){runtime.active=null;throw error;}finally{runtime.sessionOpening=null;}
 }finally{runtime.queue=runtime.queue.filter(x=>x!==ticket);}
}
export function browserStatus(userId){
 const s=runtime.active;return {active:Boolean(s?.userId===String(userId)&&!s.opening),busy:Boolean(s&&s.userId!==String(userId)),manual:Boolean(s?.userId===String(userId)&&s.manual),tabs:s?.userId===String(userId)&&!s.opening?[...s.pages].map(([id,p])=>({id,url:p.url()})):[],queued:runtime.queue.filter(x=>x.userId===String(userId)).length};
}
export async function closeBrowser(userId,{revoke=false,taskId}={}){
 if(!taskId)for(const ticket of runtime.queue)if(ticket.userId===String(userId))ticket.cancelled=true;
 if(runtime.active?.userId===String(userId)&&runtime.active.opening&&runtime.sessionOpening)try{await runtime.sessionOpening;}catch{}
 const s=runtime.active;if(s?.userId===String(userId)&&!s.opening&&(!taskId||s.taskId===String(taskId))){
  if(!s.closing)s.closing=(async()=>{try{if(!revoke){const state=await s.context.storageState();await BrowserSession.findOneAndUpdate({userId},{$set:{storageState:encryptSecret(state,`browser:${userId}`),savedAt:new Date()}},{upsert:true});}}finally{await s.context.close();if(runtime.active===s)runtime.active=null;}})();await s.closing;
 }
 if(revoke)await BrowserSession.deleteOne({userId});
 if(!runtime.active&&!runtime.queue.length&&runtime.browser){const browser=runtime.browser,proxy=runtime.proxy;runtime.browser=null;runtime.proxy=null;await browser.close();await proxy?.close();}
}
export async function browserAction({userId,taskId,task,action,signal,manual=false,frozen,uploadPath}){
 const s=await acquireBrowser(userId,taskId,signal);if(s.opening)throw new Error('浏览器正在启动');
 const abort=()=>{void closeBrowser(userId,{taskId}).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{signal?.throwIfAborted();
 if(!manual){const waitingSince=Date.now();while(s.manual){if(signal?.aborted||runtime.active!==s)throw new Error('浏览器操作已停止');if(Date.now()-waitingSince>300000)throw Object.assign(new Error('等待用户交还浏览器已超时'),{stopTask:true});await delay(400,undefined,{signal});}}
 if(manual&&!['observe','screenshot','resume'].includes(action.action))s.manual=true;
 s.lastUsed=Date.now();
 if(action.action==='takeover'){s.manual=true;return {manual:true};}
 if(action.action==='resume'){s.manual=false;return {manual:false};}
 let page=(frozen?.tabId||action.tabId)?s.pages.get(frozen?.tabId||action.tabId):s.pages.values().next().value;
 if(frozen)await validateBrowserAction(s,frozen);
 if(!page)throw new Error('页面不存在');
 if(action.action==='new_tab'&&!s.justOpened){if(s.pages.size>=3)throw new Error('最多打开 3 个页面');page=await s.context.newPage();}
 s.justOpened=false;
 if(['navigate','new_tab'].includes(action.action)&&action.url){const url=await assertPublicUrl(action.url);await page.goto(url.toString(),{waitUntil:'domcontentloaded',timeout:30000});}
 const id=[...s.pages].find(([,p])=>p===page)?.[0];
 const locator=()=>{if(frozen?.target)return frozen.target;const elements=s.elements.get(id);if(!elements||!Number.isInteger(action.element)||!elements[action.element])throw new Error('请先观察页面，再选择元素编号');return elements[action.element];};
 if(action.action==='click'){if(manual&&Number.isFinite(action.x)&&Number.isFinite(action.y)){await page.mouse.click(action.x,action.y);}else await locator().click();}
 if(action.action==='fill'){
  const target=locator();if(!manual&&(await target.getAttribute('type'))==='password')throw new Error('请在浏览器面板中手动输入密码');
  await target.fill(String(action.text || ''));
 }
 if(action.action==='type') {if(!manual)throw new Error('仅用户可直接键入');await page.keyboard.type(String(action.text || ''));}
 if(action.action==='key'){if(!manual||!['Enter','Tab','Backspace','Escape','ArrowDown','ArrowUp'].includes(action.key))throw new Error('按键不允许');await page.keyboard.press(action.key);}
 if(action.action==='scroll'){const amount=Number(action.amount);if(!Number.isFinite(amount)||Math.abs(amount)>3000)throw new Error('滚动距离无效');await page.mouse.wheel(0,amount);}
 if(action.action==='upload'){
  if(uploadPath)await locator().setInputFiles({name:action.reviewFile.name,mimeType:action.reviewFile.mimeType,buffer:await readFile(uploadPath)});else{const file=await findOwnedStoredFile({userId,fileId:action.fileId});if(!file)throw new Error('上传文件不存在');await locator().setInputFiles(getStoredFileAbsolutePath(file));}
 }
 if(action.action==='download'){
  const downloadEvent=page.waitForEvent('download',{timeout:30000});await locator().click();const download=await downloadEvent;const localPath=await download.path();
  const input=await readFile(localPath);if(input.length>20971520){await download.delete();throw new Error('下载文件超过 20 MB 限制');}
  const name=download.suggestedFilename();const file=await createStoredFile({userId,input,originalName:name,mimeType:'application/octet-stream',extension:path.extname(name).slice(1),category:'document',kind:taskId?'task-artifact':'library',ownerType:taskId?'task':'library',ownerId:taskId});await download.delete();try{return {file:await registerIntegrationFile({userId,task,file,input})};}catch(error){await deleteStoredFileDocument(file);throw error;}
 }
 if(action.action==='close_tab'){await page.close();if(!s.pages.size)await s.context.newPage();return browserStatus(userId);}
 if(!['navigate','new_tab','click','fill','type','key','scroll','upload','observe','screenshot','download'].includes(action.action))throw new Error('浏览器操作无效');
 if(action.action==='screenshot'&&!manual){const input=await page.screenshot({type:'png'});const file=await createStoredFile({userId,input,originalName:'浏览器截图.png',mimeType:'image/png',extension:'png',category:'image',kind:'task-artifact',ownerType:'task',ownerId:taskId});return {tabId:id,url:page.url(),file:await registerIntegrationFile({userId,task,file,input})};}
 return await observe(s,page,id,manual);
 }finally{signal?.removeEventListener('abort',abort);}
}
async function observe(s,page,id,manual){
 const candidates=await page.locator('a,button,input,textarea,select,[role="button"],[role="link"]').all();const elements=[];const descriptors=[];
 for(const item of candidates.slice(0,160)){if(!await item.isVisible())continue;const index=elements.length;elements.push(item);const type=await item.getAttribute('type');descriptors.push({element:index,text:(await item.innerText()).slice(0,150),label:await item.getAttribute('aria-label'),placeholder:await item.getAttribute('placeholder'),type});}
 s.elements.set(id,elements);return {tabId:id,url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,24000),elements:descriptors,...(manual?{screenshot:`data:image/jpeg;base64,${(await page.screenshot({type:'jpeg',quality:65})).toString('base64')}`}:{})};
}
// The shared browser is reclaimed after a manual session is left idle.
const timer=globalThis.__vectaixBrowserIdle ||= setInterval(()=>{const s=runtime.active;if(s&&!s.opening&&Date.now()-s.lastUsed>600000)void closeBrowser(s.userId).catch(()=>{});},60000);timer.unref();

async function pageState(page){
 const fields=[];for(const element of (await page.locator('input,textarea,select').all()).slice(0,200)){
  const type=await element.getAttribute('type');fields.push({name:await element.getAttribute('name'),label:await element.getAttribute('aria-label'),type,value:await element.inputValue(),checked:['checkbox','radio'].includes(type)?await element.isChecked():undefined});
 }
 const forms=[];for(const form of await page.locator('form').all())forms.push({action:await form.getAttribute('action'),method:await form.getAttribute('method')});
 return {url:page.url(),forms,text:(await page.locator('body').innerText()).slice(0,50000),fields};
}
export async function prepareBrowserAction({userId,taskId,action,signal}){
 const session=await acquireBrowser(userId,taskId,signal);const page=action.tabId?session.pages.get(action.tabId):session.pages.values().next().value;if(!page)throw new Error('页面不存在');
 const tabId=[...session.pages].find(([,value])=>value===page)[0];let target,targetReview;
 if(['click','fill','upload','download'].includes(action.action)){
  const locator=session.elements.get(tabId)?.[action.element];if(!locator)throw new Error('请先观察页面，再选择元素编号');target=await locator.elementHandle();if(!target||!await target.isVisible())throw new Error('目标元素已变化，请重新观察');
  targetReview={text:(await target.innerText()).slice(0,500),label:await target.getAttribute('aria-label'),href:await target.getAttribute('href'),type:await target.getAttribute('type'),name:await target.getAttribute('name')};
 }
 const state=await pageState(page);return {tabId,target,targetReview,state,review:{url:state.url,title:await page.title(),target:targetReview,fields:state.fields.filter(field=>field.type!=='hidden').map(field=>({...field,value:field.type==='password'?'（密码已填写）':field.value}))}};
}
async function validateBrowserAction(session,frozen){
 const page=session.pages.get(frozen.tabId);let valid=Boolean(page&&JSON.stringify(await pageState(page))===JSON.stringify(frozen.state));
 if(valid&&frozen.target){const target=frozen.target;valid=await target.isVisible()&&JSON.stringify({text:(await target.innerText()).slice(0,500),label:await target.getAttribute('aria-label'),href:await target.getAttribute('href'),type:await target.getAttribute('type'),name:await target.getAttribute('name')})===JSON.stringify(frozen.targetReview);}
 if(!valid)throw Object.assign(new Error('确认期间网页或目标内容发生变化，操作已停止，请重新确认'),{stopTask:true,code:'APPROVAL_TARGET_CHANGED'});
}
