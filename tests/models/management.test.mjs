import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModel, validateProvider, publicModel, publicProvider } from '../../lib/server/models/validation.mjs';

const model = { id: 'custom/chat', name: '自定义', providerId: 'service', upstreamModel: 'chat-v1', group: '自定义', enabled: true, sortOrder: 2, isDefault: true, contextWindow: 32000, maxOutputTokens: 4096, nativeInputs: ['text','image'], supportsTools: true, supportsWebSearch: true, pricing: { inputPerMillion: 2, outputPerMillion: 6, cachedInputPerMillion: 1, cacheWritePerMillion: 2 }, billingMode: 'tokens', requestOptions: {} };
test('拒绝未知协议、非安全网址和输出大于上下文的模型', () => {
  assert.throws(() => validateProvider({ id:'a', name:'a', baseUrl:'https://example.com/v1', protocol:'unknown', enabled:true }), /协议/);
  assert.throws(() => validateProvider({ id:'a', name:'a', baseUrl:'https://user:password@example.com', protocol:'responses', enabled:true }), /地址/);
  assert.throws(() => validateModel({...model,maxOutputTokens:64000}), /上下文/);
  assert.throws(() => validateModel({...model,pricing:{...model.pricing,inputPerMillion:-1}}), /价格/);
  assert.equal(validateModel(model).id,'custom/chat');
});
test('公开投影移除服务商地址、密钥及请求私有参数', () => {
  const result = publicModel({...model, apiKey:'secret', requestOptions:{private:'secret'}, providerConfig:{baseUrl:'secret'}});
  assert.equal(result.name,'自定义');
  assert.equal(result.apiKey,undefined);
  assert.equal(result.requestOptions,undefined);
  assert.equal(result.providerConfig,undefined);
  const provider = publicProvider({id:'service',name:'服务商',encryptedKey:{ciphertext:'secret'},baseUrl:'https://example.com',protocol:'responses',enabled:true});
  assert.equal(provider.hasKey,true);
  assert.equal(provider.encryptedKey,undefined);
});
