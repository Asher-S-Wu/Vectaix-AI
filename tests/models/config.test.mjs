import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { getPublicModels, getManagedModel, getModelConnection, getDefaultTranscriptionModel, getManagedChatRates } from '../../lib/server/models/service.js';

test('模型目录、默认模型和价格无需数据库，由代码决定',async()=>{
 const catalog=await getPublicModels();
 assert.equal(catalog.models.length,6);
 assert.equal(catalog.defaultModelId,'google/gemini-3.8-flash');
 assert.equal((await getDefaultTranscriptionModel()).id,catalog.defaultModelId);
 assert.ok((await getDefaultTranscriptionModel()).nativeInputs.includes('audio'));
 const model=await getManagedModel('gpt-6-astra');
 model.requestOptions.reasoning.effort='low';
 model.pricing.inputPerMillion=999;
 assert.equal((await getManagedModel(model.id)).requestOptions.reasoning.effort,'max');
 assert.equal((await getManagedChatRates())[model.id].inputPerMillion,10);
 await assert.rejects(getManagedModel('database-custom-model'),/模型不存在/);
});
test('连接只读取服务器环境密钥，公开目录不泄漏密钥',async()=>{
 process.env.OPENROUTER_API_KEY='test-env-key';
 const connection=await getModelConnection('gpt-6-astra');
 assert.equal(connection.provider.apiKey,'test-env-key');
 assert.equal(connection.provider.baseUrl,'https://openrouter.ai/api/v1');
 assert.equal(connection.provider.protocol,'responses');
 assert.ok(!JSON.stringify(await getPublicModels()).includes('test-env-key'));
 delete process.env.OPENROUTER_API_KEY;
 await assert.rejects(getModelConnection('gpt-6-astra'),/尚未配置/);
});
test('管理员模型、服务商和积分费率管理接口已删除',async()=>{
 for(const path of ['app/api/admin/models/route.js','app/api/admin/providers/route.js','app/api/admin/billing-settings/route.js','app/api/admin/credit-transactions/route.js','app/components/settings/panels/ModelsPanel.js']) {
  await assert.rejects(access(path),{code:'ENOENT'});
 }
});
