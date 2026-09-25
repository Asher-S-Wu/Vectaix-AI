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
delete process.env.MICU_OPENAI_API_KEY;
delete process.env.DASHSCOPE_SINGAPORE_API_KEY;
const {workAsyncStorage}=await import('next/dist/server/app-render/work-async-storage.external.js');
const {workUnitAsyncStorage}=await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const {RequestCookies}=await import('next/dist/server/web/spec-extension/cookies.js');
const {default:dbConnect}=await import('../../lib/db.js');
const {default:User}=await import('../../models/User.js');
const {default:Session}=await import('../../models/Session.js');
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
test('模型目录需要登录，并且不公开服务器密钥和请求配置',async()=>{
 const member=await login('member@example.com');
 assert.equal((await call(null,publicModels.GET,new Request('http://test/api/models'))).status,401);
 process.env.MICU_OPENAI_API_KEY='never-show-this-secret';
 const response=await call(member,publicModels.GET,new Request('http://test/api/models'));
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.models.length,5);
 assert.ok(!JSON.stringify(payload).includes('never-show-this-secret'));
 assert.equal(payload.models[0].baseUrl,undefined);
 assert.equal(payload.models[0].requestOptions,undefined);
 assert.equal(payload.models[0].headers,undefined);
});

test('语音记录删除失败时不返回内部异常', async t => {
 const member = await login('audio-delete@example.com');
 const { default: AudioGeneration } = await import('../../models/AudioGeneration.js');
 const { DELETE } = await import('../../app/api/media/audio/generations/[id]/route.js');
 t.mock.method(AudioGeneration, 'findOne', () => { throw new Error('内部数据库异常：private-value'); });
 t.mock.method(console, 'error', () => {});
 const response = await call(member, request => DELETE(request, { params: Promise.resolve({ id: 'sample' }) }),
  new Request('http://test/api/media/audio/generations/sample', { method: 'DELETE' }));
 assert.equal(response.status, 500);
 assert.deepEqual(await response.json(), { success: false, message: '删除语音记录失败' });
});

test('上传文件的内部异常不返回给用户', async t => {
 const member = await login('upload-error@example.com');
 const { POST } = await import('../../app/api/upload/route.js');
 const request = new Request('http://test/api/upload', { method: 'POST' });
 request.formData = async () => { throw new Error('internal-upload-secret'); };
 t.mock.method(console, 'error', () => {});
 const response = await call(member, POST, request);
 assert.equal(response.status, 500);
 assert.deepEqual(await response.json(), { error: '文件上传失败' });
});
