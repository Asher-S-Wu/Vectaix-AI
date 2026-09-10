import test from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose from 'mongoose';
import OpenAI from 'openai';
const mongo=await MongoMemoryServer.create();
process.env.MONGO_URI=mongo.getUri();
process.env.APP_SECRETS_KEY=Buffer.alloc(32,9).toString('base64');
const service=await import('../../lib/server/models/service.js');
const {testManagedModel}=await import('../../lib/server/models/api.js');
const {runOpenAICompatibleChat}=await import('../../lib/server/providers/directChat.js');
await service.saveProvider({id:'activation',name:'测试服务',baseUrl:'https://1.1.1.1/v1',protocol:'chat-completions',enabled:true,apiKey:'secret'},{create:true});
const draft={id:'activation/model',name:'测试模型',providerId:'activation',upstreamModel:'fixture',group:'测试',enabled:false,isDefault:false,isTranscriptionDefault:false,sortOrder:0,contextWindow:4096,maxOutputTokens:256,nativeInputs:['text'],supportsTools:false,supportsWebSearch:false,pricing:{inputPerMillion:1,outputPerMillion:2,cachedInputPerMillion:1,cacheWritePerMillion:1},billingMode:'tokens',requestOptions:{}};
const runModel=(options,{model,provider})=>runOpenAICompatibleChat({...options,requestModel:model.upstreamModel,requestExtras:{max_completion_tokens:model.maxOutputTokens},client:new OpenAI({apiKey:provider.apiKey,baseURL:provider.baseUrl,maxRetries:0,fetch:async()=>new Response([{id:'fixture',choices:[{delta:{content:'连接成功'},finish_reason:null}]},{id:'fixture',choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2}}].map(value=>`data: ${JSON.stringify(value)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})})});
test.after(async()=>{await mongoose.disconnect();await mongo.stop();});
test('新模型必须保存价格、停用创建，并通过真实协议响应后才能启用',async()=>{
 await assert.rejects(service.saveModel({...draft,pricing:{}},{create:true}),/价格/);
 await assert.rejects(service.saveModel({...draft,enabled:true},{create:true}),/停用/);
 await service.saveModel(draft,{create:true});
 await assert.rejects(service.saveModel({...draft,enabled:true,connectionTestedAt:new Date()}),/测试/);
 await assert.rejects(service.saveModel({...draft,enabled:true}),/测试/);
 await assert.rejects(testManagedModel(draft.id,{runModel:async()=>{throw new Error('连接失败');}}),/连接失败/);
 await assert.rejects(service.saveModel({...draft,enabled:true}),/测试/);
 await assert.rejects(testManagedModel(draft.id,{runModel:async()=>({text:'连接成功',usageRecords:[]})}),/可计费/);
 await testManagedModel(draft.id,{runModel});
 const enabled=await service.saveModel({...draft,enabled:true});
 assert.equal(enabled.enabled,true);assert.ok(enabled.connectionTestedAt);
 await service.saveModel({...draft,enabled:true,name:'修改显示名称'});
 assert.equal((await service.getManagedModel(draft.id)).enabled,true);
});
test('测试失败不改变现有启用和默认状态，但清除成功标记',async()=>{
 await service.saveModel({...draft,enabled:true,isDefault:true});
 await assert.rejects(testManagedModel(draft.id,{runModel:async()=>{throw new Error('网络失败');}}),/网络失败/);
 const model=(await service.listManagedModels({admin:true})).find(model=>model.id===draft.id);
 assert.equal(model.enabled,true);assert.equal(model.isDefault,true);assert.equal(model.connectionTestedAt,null);
});
test('修改调用配置会停用，合法价格修改保留启用及测试状态，服务商连接变化仍需重测',async()=>{
 let model=await service.saveModel({...draft,enabled:true,upstreamModel:'changed'});
 assert.equal(model.enabled,false);assert.equal(model.connectionTestedAt,null);
 await assert.rejects(service.saveModel({...model,enabled:true}),/测试/);
 await testManagedModel(draft.id,{runModel});
 model=await service.saveModel({...model,enabled:true,isDefault:true});
 const testedAt=model.connectionTestedAt;
 model=await service.saveModel({...model,pricing:{...model.pricing,inputPerMillion:3}});
 assert.equal(model.enabled,true);assert.equal(model.isDefault,true);assert.deepEqual(model.connectionTestedAt,testedAt);
 await service.saveProvider({id:'activation',name:'测试服务',baseUrl:'https://1.1.1.1/v2',protocol:'chat-completions',enabled:true,apiKey:'replacement'});
 await assert.rejects(service.getManagedModel(draft.id),/停用/);
 await assert.rejects(service.saveModel({...model,enabled:true}),/测试/);
});
test('测试期间更改服务商连接也不能复用旧成功结果',async()=>{
 await assert.rejects(testManagedModel(draft.id,{runModel:async(options,connection)=>{
   await service.saveProvider({id:'activation',name:'测试服务',baseUrl:'https://1.1.1.1/v3',protocol:'chat-completions',enabled:true});
   return runModel(options,connection);
 }}),/配置.*变化/);
 const model=await service.getManagedModel(draft.id,{includeDisabled:true});
 assert.equal(model.connectionTestedAt,null);assert.equal(model.enabled,false);
});
test('测试期间修改模型不能用旧连接结果启用新配置',async()=>{
 await assert.rejects(testManagedModel(draft.id,{runModel:async(options,connection)=>{
   const model=await service.getManagedModel(draft.id,{includeDisabled:true});
   await service.saveModel({...model,isDefault:false,upstreamModel:'concurrent-change'});
   return runModel(options,connection);
 }}),/配置.*变化/);
 const model=await service.getManagedModel(draft.id,{includeDisabled:true});
 await assert.rejects(service.saveModel({...model,isDefault:false,enabled:true}),/测试/);
});
