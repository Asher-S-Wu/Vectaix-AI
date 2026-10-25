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
process.env.ADMIN_EMAILS='admin@example.com,audio-delete@example.com,skills-admin@example.com';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.FISH_API_KEY;
const {workAsyncStorage}=await import('next/dist/server/app-render/work-async-storage.external.js');
const {workUnitAsyncStorage}=await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const {RequestCookies}=await import('next/dist/server/web/spec-extension/cookies.js');
const {default:dbConnect}=await import('../../lib/db.js');
const {default:User}=await import('../../models/User.js');
const {default:Session}=await import('../../models/Session.js');
const publicModels=await import('../../app/api/models/route.js');
await dbConnect();
const modelAdmin = await import('../../app/api/admin/models/route.js');
const { saveAdminModelSettings } = await import('../../lib/server/models/service.js');
const { DEFAULT_MODEL_SETTINGS } = await import('../../lib/server/models/config.js');
await saveAdminModelSettings({ ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://models.example.com/v1', modelId: 'agent-model', apiKey: 'never-show-this-secret' }, new mongoose.Types.ObjectId());
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
test('模型目录需要登录，并且不公开服务器密钥和请求配置',async()=>{
 const member=await login('member@example.com');
 assert.equal((await call(null,publicModels.GET,new Request('http://test/api/models'))).status,401);
 process.env.DEEPSEEK_API_KEY='never-show-this-secret';
 const response=await call(member,publicModels.GET,new Request('http://test/api/models'));
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.models.length,1);
 assert.ok(!JSON.stringify(payload).includes('never-show-this-secret'));
 assert.equal(payload.models[0].baseUrl,undefined);
 assert.equal(payload.models[0].requestOptions,undefined);
 assert.equal(payload.models[0].headers,undefined);
});

test('管理员模型配置仅对管理员开放，普通用户无法写入全局配置', async () => {
 const member = await login('model-member@example.com');
 const admin = await login('admin@example.com');
 for (const token of [null, member]) {
  assert.equal((await call(token, modelAdmin.GET, new Request('http://test/api/admin/models'))).status, 403);
  assert.equal((await call(token, modelAdmin.PUT, new Request('http://test/api/admin/models', { method: 'PUT', body: '{}' }))).status, 403);
 }
 const result = await call(admin, modelAdmin.GET, new Request('http://test/api/admin/models'));
 assert.equal(result.status, 200);
 const body = await result.json();
 assert.equal(body.config.hasApiKey, true);
 assert.doesNotMatch(JSON.stringify(body), /never-show-this-secret|encryptedApiKey/);
});

test('技能后台的查询、安装、启停、删除和更新仅对管理员开放', async () => {
 const member = await login('skills-member@example.com');
 const admin = await login('skills-admin@example.com');
 const skills = await import('../../app/api/admin/skills/route.js');
 const skill = await import('../../app/api/admin/skills/[id]/route.js');
 const update = await import('../../app/api/admin/skills/[id]/update/route.js');
 const context = { params: Promise.resolve({ id: new mongoose.Types.ObjectId().toString() }) };
 for (const token of [null, member]) {
  for (const [handler, method, path] of [[skills.GET, 'GET', ''], [skills.POST, 'POST', ''], [skill.PATCH, 'PATCH', '/id'], [skill.DELETE, 'DELETE', '/id'], [update.POST, 'POST', '/id/update']]) {
   const response = await call(token, req => handler(req, context), new Request(`http://test/api/admin/skills${path}`, { method }));
   assert.equal(response.status, 403, `${method} skills${path}`);
  }
 }
 const response = await call(admin, skills.GET, new Request('http://test/api/admin/skills'));
 assert.equal(response.status, 200);
 assert.ok(Array.isArray((await response.json()).skills));
});

test('语音记录删除失败时不返回内部异常', async t => {
 const member = await login('audio-delete@example.com');
 const { default: AudioGeneration } = await import('../../models/FishAudioGeneration.js');
 const { DELETE } = await import('../../app/api/media/audio/fish/generations/[id]/route.js');
 t.mock.method(AudioGeneration, 'findOne', () => { throw new Error('内部数据库异常：private-value'); });
 t.mock.method(console, 'error', () => {});
 const response = await call(member, request => DELETE(request, { params: Promise.resolve({ id: 'sample' }) }),
  new Request('http://test/api/media/audio/fish/generations/sample', { method: 'DELETE' }));
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
