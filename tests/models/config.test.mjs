import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { getPublicModels, getManagedModel, getModelConnection, getManagedChatRates } from '../../lib/server/models/service.js';

test('模型目录、默认模型和价格无需数据库，由代码决定',async()=>{
 const catalog=await getPublicModels();
 assert.equal(catalog.models.length,1);
 assert.equal(catalog.defaultModelId,'deepseek-flash');
 const assistant=catalog.models[0];
 assert.equal(assistant.name,'助手');
 assert.equal(assistant.providerId,'deepseek');
 assert.equal(assistant.contextWindow,1048576);
 assert.equal(assistant.maxOutputTokens,393216);
 assert.deepEqual(assistant.nativeInputs,['text','image']);
 const model=await getManagedModel();
 model.requestOptions.reasoning.effort='low';
 model.pricing.inputPerMillion=999;
 assert.equal((await getManagedModel()).requestOptions.reasoning.effort,'max');
 assert.equal((await getManagedModel()).requestOptions.top_p,1);
 assert.equal((await getManagedModel()).defaultOutputTokens,393216);
 assert.equal((await getManagedChatRates())[model.id].inputPerMillion,0.3);
 await assert.rejects(getManagedModel('database-custom-model'),/模型不存在/);
});
test('连接固定官方服务，公开目录不泄漏密钥',async t=>{
 const previous=process.env.DEEPSEEK_API_KEY;
 t.after(()=>{if(previous===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous;});
 process.env.DEEPSEEK_API_KEY='test-env-key';
 const connection=await getModelConnection('arbitrary-client-model');
 assert.equal(connection.provider.apiKey,'test-env-key');
 assert.equal(connection.model.id,'deepseek-flash');
 assert.equal(connection.provider.baseUrl,'https://api.deepseek.com');
 assert.equal(connection.provider.protocol,'responses');
 assert.ok(!JSON.stringify(await getPublicModels()).includes('test-env-key'));
 delete process.env.DEEPSEEK_API_KEY;
 await assert.rejects(getModelConnection(),/对话服务尚未配置/);
});
test('管理员模型、服务商和积分费率管理接口已删除',async()=>{
 for(const path of ['app/api/admin/models/route.js','app/api/admin/providers/route.js','app/api/admin/billing-settings/route.js','app/api/admin/credit-transactions/route.js','app/components/settings/panels/ModelsPanel.js']) {
  await assert.rejects(access(path),{code:'ENOENT'});
 }
});
