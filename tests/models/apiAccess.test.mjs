import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import {createHash,randomBytes} from 'node:crypto';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose from 'mongoose';
globalThis.AsyncLocalStorage=AsyncLocalStorage;
const mongo=await MongoMemoryServer.create();
process.env.MONGO_URI=mongo.getUri();
process.env.APP_SECRETS_KEY=Buffer.alloc(32,6).toString('base64');
process.env.ADMIN_EMAILS='admin@example.com';
delete process.env.OPENROUTER_API_KEY;
delete process.env.DASHSCOPE_SINGAPORE_API_KEY;
const {workAsyncStorage}=await import('next/dist/server/app-render/work-async-storage.external.js');
const {workUnitAsyncStorage}=await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const {RequestCookies}=await import('next/dist/server/web/spec-extension/cookies.js');
const {default:dbConnect}=await import('../../lib/db.js');
const {default:User}=await import('../../models/User.js');
const {default:Session}=await import('../../models/Session.js');
const {default:Provider}=await import('../../models/ModelProvider.js');
const adminProviders=await import('../../app/api/admin/providers/route.js');
const adminModels=await import('../../app/api/admin/models/route.js');
const publicModels=await import('../../app/api/models/route.js');
const transcription=await import('../../app/api/voice/transcribe/route.js');
await dbConnect();
async function login(email) {
 const user=await User.create({email,password:'hash'});
 const token=randomBytes(32).toString('base64url');
 await Session.create({userId:user._id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+60000)});
 return token;
}
function call(token,handler,request) {
 const headers=new Headers(token?{cookie:`token=${token}`}:{}) ;
 return workAsyncStorage.run({route:'/api/models'},()=>workUnitAsyncStorage.run({type:'request',phase:'render',cookies:new RequestCookies(headers)},()=>handler(request)));
}
test.after(async()=>{await mongoose.disconnect();await mongo.stop();});
test('麦克风未授权时直接请求转写返回禁止，不读取录音或发送模型请求',async()=>{
 const member=await login('voice-no-permission@example.com');
 const response=await call(member,transcription.POST,new Request('http://test/api/voice/transcribe',{method:'POST',body:'invalid recording'}));
 assert.equal(response.status,403);
 assert.match((await response.json()).error,/麦克风/);
});
test('未登录用户不能读取目录，普通用户不能读取或修改管理员配置',async()=>{
 const member=await login('member@example.com');
 assert.equal((await call(null,publicModels.GET,new Request('http://test/api/models'))).status,401);
 assert.equal((await call(member,adminModels.GET,new Request('http://test/api/admin/models'))).status,403);
 assert.equal((await call(member,adminProviders.POST,new Request('http://test/api/admin/providers',{method:'POST',body:'{}'}))).status,403);
 assert.equal(await Provider.countDocuments({}),0);
});
test('管理员保存密钥后，管理员列表及普通模型目录均不返回密钥',async()=>{
 const admin=await login('admin@example.com');
 const member=await login('member2@example.com');
 const response=await call(admin,adminProviders.POST,new Request('http://test/api/admin/providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'secure',name:'服务商',protocol:'responses',baseUrl:'https://1.1.1.1/v1',enabled:true,apiKey:'never-show-this-secret'})}));
 assert.equal(response.status,201);
 assert.ok(!(await response.text()).includes('never-show-this-secret'));
 const list=await call(admin,adminProviders.GET,new Request('http://test/api/admin/providers'));
 assert.ok(!(await list.text()).includes('never-show-this-secret'));
 const publicResponse=await call(member,publicModels.GET,new Request('http://test/api/models'));
 assert.equal(publicResponse.status,200);
 const payload=await publicResponse.json();
 assert.equal(payload.models[0].baseUrl,undefined);
 assert.equal(payload.models[0].requestOptions,undefined);
});
