import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-chromium';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import User from '../../models/User.js';
const base='http://localhost:3100',mongoUri='mongodb://127.0.0.1:27179/test';
const email=`test-devices-${Date.now()}@example.test`,password='Device-Test-2026!';let browser,userId,conversationId;let sessionIndex=80;
before(async()=>{
 await mongoose.connect(mongoUri);
 const user=await User.create({email,password:await bcrypt.hash(password,10)});userId=user._id;
 await mongoose.connection.collection('usersettings').insertOne({userId,permissions:{camera:true,microphone:true,clipboard:true,geolocation:true,notifications:false,browser:false,externalTools:false}});
 const conversation=await mongoose.connection.collection('conversations').insertOne({userId,title:'test 朗读会话',model:'gpt-5.4',projectId:null,pinned:false,activeTaskId:null,settings:{memoryEnabled:true,disabledSkillIds:[]},updatedAt:new Date(),messages:[{id:crypto.randomUUID(),role:'model',content:'这是一段测试朗读的回复。',type:'text',createdAt:new Date()}]});conversationId=conversation.insertedId;
 browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
});
after(async()=>{
 await browser?.close();for(const name of ['sessions','usersettings','passkeys','authchallenges','conversations','storedfiles','workspacedocuments'])await mongoose.connection.collection(name).deleteMany({userId});await User.deleteOne({_id:userId});await mongoose.disconnect();
});
async function session({mobile=false,init}={}){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},extraHTTPHeaders:{'x-forwarded-for':`192.0.2.${sessionIndex++}`}});if(init)await context.addInitScript(init);
 const response=await context.request.post(base+'/api/auth/login',{data:{email,password}});assert.equal(response.status(),200,await response.text());
 const page=await context.newPage();return {context,page};
}
async function chat(page){await page.goto(base);await page.getByRole('button',{name:'更多输入方式'}).waitFor();}
async function menu(page,label){await page.getByRole('button',{name:'更多输入方式'}).click();await page.getByRole('button',{name:label,exact:true}).click();}
test('virtual passkey registration, sign out, discoverable login, removal and expiration', {timeout:90000},async()=>{
 const {context,page}=await session();const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 try{
  await page.goto(base+'/settings?section=permissions');await page.getByRole('textbox',{name:'通行密钥名称'}).fill('test 虚拟通行密钥');
  const registered=page.waitForResponse(r=>r.url().endsWith('/api/auth/passkeys')&&r.request().postDataJSON()?.action==='registration-verify');await page.getByRole('button',{name:'添加通行密钥',exact:true}).click();assert.equal((await registered).status(),200);await page.getByText('test 虚拟通行密钥',{exact:true}).waitFor();
  assert.equal((await context.request.delete(base+'/api/auth/me')).status(),200);await page.goto(base);await page.getByRole('button',{name:'使用通行密钥登录'}).click();await page.getByRole('button',{name:'更多输入方式'}).waitFor();
  assert.equal((await (await context.request.get(base+'/api/auth/me')).json()).user.email,email);
  await page.goto(base+'/settings?section=permissions');await page.getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('button',{name:'确认移除',exact:true}).click();await page.getByText('test 虚拟通行密钥',{exact:true}).waitFor({state:'detached'});
  const expired=await (await context.request.post(base+'/api/auth/passkeys',{data:{action:'registration-options',name:'test 过期验证'}})).json();await mongoose.connection.collection('authchallenges').updateOne({_id:new mongoose.Types.ObjectId(expired.challengeId)},{$set:{expiresAt:new Date(Date.now()-1000)}});
  const denied=await context.request.post(base+'/api/auth/passkeys',{data:{action:'registration-verify',challengeId:expired.challengeId,response:{}}});assert.equal(denied.status(),400);assert.match((await denied.json()).error,/过期/);
 }finally{await context.close();}
});
test('recording submits real fake-device audio and an operation id, while showing an explicit unavailable-service error',{timeout:60000},async()=>{
 const {context,page}=await session();let captured;
 await page.route('**/api/voice/transcribe',async route=>{captured={headers:route.request().headers(),body:route.request().postDataBuffer()};await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试环境未连接语音服务'})});});
 try{await chat(page);await page.getByRole('button',{name:'录音输入',exact:true}).click();await page.getByText('正在录音',{exact:true}).waitFor();await page.waitForTimeout(600);await page.getByRole('button',{name:'停止录音并转文字'}).click();await page.getByText('测试环境未连接语音服务',{exact:true}).waitFor();assert.match(captured.headers['x-credit-operation-id'],/^[0-9a-f-]{36}$/);assert.match(captured.headers['content-type'],/multipart\/form-data/);assert.ok(captured.body.length>500);assert.match(captured.body.toString('latin1'),/name="file"/);}finally{await context.close();}
});
test('fake camera preview captures a JPEG and uploads it into isolated user storage',{timeout:60000},async()=>{
 const {context,page}=await session();let fileId;
 try{await chat(page);await menu(page,'拍照上传');await page.getByRole('dialog',{name:'拍照上传'}).waitFor();const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/upload'));await page.getByRole('button',{name:'拍照并添加附件'}).click();
 const response=await uploaded;const data=await response.json();fileId=data.fileId;assert.equal(response.status(),201,JSON.stringify(data));assert.ok(fileId);assert.equal(data.mimeType,'image/jpeg');assert.ok(data.size>1000);assert.equal((await context.request.get(base+'/api/files/'+fileId)).status(),200);await page.getByRole('dialog',{name:'拍照上传'}).waitFor({state:'detached'});
 }finally{if(fileId)await context.request.delete(base+'/api/files/'+fileId);await context.close();}
});
test('unsupported clipboard and location show useful errors, and mobile settings stays reachable',{timeout:60000},async()=>{
 const {context,page}=await session({mobile:true,init:()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});}});
 try{await chat(page);await menu(page,'读取剪贴板');await page.getByText('当前浏览器不支持读取剪贴板',{exact:true}).waitFor();await page.getByRole('button',{name:'添加当前位置',exact:true}).click();await page.getByText('当前浏览器不支持定位',{exact:true}).waitFor();await page.getByRole('button',{name:'设置',exact:true}).last().click();await page.waitForURL(/\/settings/);assert.ok((await page.locator('body').boundingBox()).width<=390);}finally{await context.close();}
});
test('denied device permissions are reported without starting recording or adding location',{timeout:60000},async()=>{
 const {context,page}=await session({init:()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))}});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(_success,failure)=>failure({code:1})}});Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))});}});
 try{await chat(page);await page.getByRole('button',{name:'录音输入',exact:true}).click();await page.getByText('麦克风权限已被拒绝',{exact:true}).waitFor();await menu(page,'拍照上传');await page.getByText('相机权限已被拒绝',{exact:true}).waitFor();await page.getByRole('button',{name:'读取剪贴板',exact:true}).click();await page.getByText('未获得剪贴板读取权限',{exact:true}).waitFor();await page.getByRole('button',{name:'添加当前位置',exact:true}).click();await page.getByText('未能获取位置，请检查定位权限',{exact:true}).waitFor();assert.equal(await page.getByText('正在录音',{exact:true}).count(),0);}finally{await context.close();}
});
test('stopping reply playback aborts a pending speech request',{timeout:60000},async()=>{
 const {context,page}=await session();let release;
 const pending=new Promise(resolve=>{release=resolve;});await page.route('**/api/voice/speak',async route=>{await pending;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"测试未连接语音服务"}'}).catch(()=>{});});
 try{await context.addInitScript(id=>localStorage.setItem('vectaix-current-conversation',id),String(conversationId));await chat(page);await page.getByRole('button',{name:'朗读回复',exact:true}).click();await page.getByRole('button',{name:'停止朗读',exact:true}).waitFor();const aborted=page.waitForEvent('requestfailed',r=>r.url().endsWith('/api/voice/speak'));await page.getByRole('button',{name:'停止朗读',exact:true}).click();await aborted;await page.getByRole('button',{name:'朗读回复',exact:true}).waitFor();}finally{release();await context.close();}
});

test('canceling passkey device authorization leaves no credential registered',{timeout:60000},async()=>{
 const {context,page}=await session({init:()=>{Object.defineProperty(navigator.credentials,'create',{configurable:true,value:()=>Promise.reject(new DOMException('User cancelled device authorization','NotAllowedError'))});}});
 try{await page.goto(base+'/settings?section=permissions');await page.getByRole('textbox',{name:'通行密钥名称'}).fill('test 已取消密钥');await page.getByRole('button',{name:'添加通行密钥',exact:true}).click();await page.getByRole('alert').filter({hasText:/cancelled|取消|not allowed/i}).waitFor();const keys=await (await context.request.get(base+'/api/auth/passkeys')).json();assert.equal(keys.passkeys.length,0);}finally{await context.close();}
});
