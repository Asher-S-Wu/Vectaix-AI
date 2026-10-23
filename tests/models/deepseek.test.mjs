import test from 'node:test';
import assert from 'node:assert/strict';
import { runDirectChat } from '../../lib/server/providers/directChat.js';
import { sanitizeMessage } from '../../lib/server/conversations/sanitize.js';

const fixtureKey = 'protocol-test-key';
const previousKey = process.env.DEEPSEEK_API_KEY;
process.env.DEEPSEEK_API_KEY = fixtureKey;
test.after(() => { if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey; });
const base = { messages: [{ role: 'user', content: '查询编号' }], system: '中文回答', onText() {}, onThought() {} };
const tool = { name: 'lookup', description: '查询编号', parameters: { type: 'object', properties: {}, additionalProperties: false } };
const usage = { input_tokens: 12, output_tokens: 5, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } };
const created = 1792720800;
function stream(events) { return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }); }
function reasoning(text = '整理查询结果') { return { type: 'reasoning', id: 'reasoning-id', content: [{ type: 'reasoning_text', text }], summary: [] }; }
function message(text = '编号 42') { return { type: 'message', id: 'message-id', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }; }
function terminal(output, stats = usage, type = 'response.completed') { return { type, response: { id: 'response-id', created_at: created, status: type.split('.')[1], output, usage: stats } }; }
function completed() { return stream([{ type: 'response.reasoning_text.delta', delta: '整理查询结果' }, { type: 'response.output_text.delta', delta: '编号 42' }, terminal([reasoning(), message()])]); }
function toolReply(stats = usage) { return stream([
  { type: 'response.reasoning_text.delta', delta: '查询工具提供的编号' },
  { type: 'response.function_call_arguments.delta', delta: '{' },
  { type: 'response.function_call_arguments.delta', delta: '}' },
  terminal([reasoning('查询工具提供的编号'), { type: 'function_call', id: 'function-id', call_id: 'lookup-1', name: 'lookup', arguments: '{}' }], stats),
]); }
function storedMessage(providerState) { return { role: 'model', type: 'text', content: '编号 42', parts: [{ text: '编号 42' }], providerState }; }

test('官方Responses固定模型、max思考和最大输出，记录真实用量及时间', async () => {
  let request;
  const texts = [], thoughts = [];
  const result = await runDirectChat({ ...base, model: 'client-selected-model', onText: value => texts.push(value), onThought: value => thoughts.push(value), fetchImpl: async (url, init) => {
    request = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return completed();
  } });
  assert.equal(request.url, 'https://api.deepseek.com/responses');
  assert.equal(request.headers.get('authorization'), `Bearer ${fixtureKey}`);
  assert.equal(request.body.model, 'deepseek-flash');
  assert.equal(request.body.max_output_tokens, 393216);
  assert.deepEqual(request.body.reasoning, { effort: 'max' });
  assert.equal(request.body.top_p, 1);
  assert.equal(request.body.instructions, '中文回答');
  for (const key of ['previous_response_id', 'include', 'stream_options', 'store', 'service_tier', 'text', 'max_tokens', 'thinking', 'prompt_cache_key']) assert.equal(request.body[key], undefined);
  assert.deepEqual(texts, ['编号 42']);
  assert.deepEqual(thoughts, ['整理查询结果']);
  assert.deepEqual(result.usageRecords[0], { usage, responseId: 'response-id', created });
});

test('图片使用original精度，预算限制传到max_output_tokens', async () => {
  let body;
  const content = [{ type: 'text', text: '描述图片' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }];
  await runDirectChat({ ...base, messages: [{ role: 'user', content }], resolveMaxOutputTokens: async () => 1024, fetchImpl: async (url, init) => { body = JSON.parse(init.body); return completed(); } });
  assert.deepEqual(body.input[0].content, [{ type: 'input_text', text: '描述图片' }, { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=', detail: 'original' }]);
  assert.equal(body.max_output_tokens, 1024);
});

test('完整思考和函数结果跨调用及后续轮次回传', async () => {
  const requests = [], calls = [], records = [];
  const fetchImpl = async (url, init) => { requests.push(JSON.parse(init.body)); return requests.length === 1 ? toolReply() : completed(); };
  const result = await runDirectChat({ ...base, tools: [tool], fetchImpl, executeTool: async call => { calls.push(call); return '42'; }, onUsageRecord: record => records.push(record) });
  assert.deepEqual(calls, [{ id: 'lookup-1', name: 'lookup', arguments: '{}' }]);
  assert.equal(records.length, 2);
  assert.equal(requests[0].tool_choice, 'auto');
  assert.deepEqual(requests[0].tools, [{ type: 'function', ...tool }]);
  assert.deepEqual(requests[1].input[1], reasoning('查询工具提供的编号'));
  assert.deepEqual(requests[1].input[3], { type: 'function_call_output', call_id: 'lookup-1', output: '42' });
  const saved = sanitizeMessage(storedMessage(result.providerState), 0).providerState;
  await runDirectChat({ ...base, tools: [tool], fetchImpl, messages: [...base.messages, { role: 'assistant', content: result.text, providerState: saved }, { role: 'user', content: '继续' }] });
  assert.deepEqual(requests[2].input.slice(1, 6), saved.responses.items);
});

test('历史文本会话使用当前助手继续，旧服务原生状态不传入', async () => {
  let body;
  await runDirectChat({ ...base, messages: [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '之前的回答', providerState: { responses: { model: 'prior-model', providerId: 'prior-provider', items: [{ role: 'system', content: 'obsolete' }] } } }, { role: 'user', content: '继续' }], fetchImpl: async (url, init) => { body = JSON.parse(init.body); return completed(); } });
  assert.equal(body.input[1].content, '之前的回答');
  assert.ok(!JSON.stringify(body).includes('obsolete'));
});

test('工具图片使用original精度并随完整原生状态保存', async () => {
  const requests = [];
  let imagePending = false;
  const image = { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=', detail: 'original' };
  const injected = { role: 'user', content: [image] };
  const result = await runDirectChat({ ...base, tools: [tool],
    fetchImpl: async (url, init) => { requests.push(JSON.parse(init.body)); return requests.length === 1 ? toolReply() : completed(); },
    prepareMessages: async input => { if (imagePending) { input.push(injected); imagePending = false; } return input; },
    executeTool: async () => { imagePending = true; return [{ type: 'input_image', image_url: image.image_url }]; },
  });
  assert.deepEqual(requests[1].input[3].output, [image]);
  assert.deepEqual(requests[1].input[4], injected);
  const saved = sanitizeMessage(storedMessage(result.providerState), 0).providerState;
  assert.deepEqual(saved.responses.items[3], injected);
});

test('缺少用量、未授权工具或轮次耗尽时均不执行工具', async () => {
  for (const scenario of ['usage', 'unauthorized', 'exhausted']) {
    let calls = 0;
    await assert.rejects(runDirectChat({ ...base, tools: scenario === 'unauthorized' ? [{ ...tool, name: 'different_tool' }] : [tool], maxToolPasses: scenario === 'exhausted' ? 1 : 2, executeTool: async () => { calls++; return '42'; }, fetchImpl: async () => toolReply(scenario === 'usage' ? { input_tokens: 12 } : usage) }), /用量不完整|未授权|轮次已用完/);
    assert.equal(calls, 0);
  }
});

test('中断流不视为完成，长度用尽仍保留可结算用量', async () => {
  await assert.rejects(runDirectChat({ ...base, fetchImpl: async () => stream([{ type: 'response.output_text.delta', delta: '未完成' }]) }), /连接中断/);
  const records = [];
  await assert.rejects(runDirectChat({ ...base, onUsageRecord: record => records.push(record), fetchImpl: async () => stream([terminal([message()], usage, 'response.incomplete')]) }), /长度上限/);
  assert.equal(records.length, 1);
});

test('服务认证错误只返回公共提示且只请求一次', async () => {
  let attempts = 0;
  await assert.rejects(runDirectChat({ ...base, fetchImpl: async () => { attempts++; return Response.json({ error: { message: `Authorization: Bearer ${fixtureKey}`, code: 'invalid_api_key' } }, { status: 401 }); } }), error => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /protocol-test-key|Authorization|Bearer/);
    assert.doesNotMatch(error.message, /deepseek/i);
    return true;
  });
  assert.equal(attempts, 1);
});

test('原生状态完整保存超过25万字的思考和超过200条工具记录', () => {
  const items = [];
  for (let index = 0; index < 101; index++) {
    items.push(reasoning(index === 0 ? '思'.repeat(250001) : '继续查询'), { type: 'function_call', call_id: `c-${index}`, name: 'lookup', arguments: '{}' }, { type: 'function_call_output', call_id: `c-${index}`, output: '42' });
  }
  items.push(message());
  const state = { responses: { model: 'deepseek-flash', providerId: 'deepseek', items } };
  assert.deepEqual(sanitizeMessage(storedMessage(state), 0).providerState, state);
});

test('状态校验拒绝错误服务标识和未配对工具结果', () => {
  const state = { model: 'deepseek-flash', providerId: 'deepseek', items: [message()] };
  for (const bad of [{ ...state, model: 'other' }, { ...state, providerId: 'other' }, { ...state, items: [{ type: 'function_call_output', call_id: 'missing', output: '42' }] }, { ...state, items: [{ type: 'reasoning', content: [{ type: 'reasoning_text' }] }, message()] }]) {
    assert.throws(() => sanitizeMessage(storedMessage({ responses: bad }), 0), /responses invalid/);
  }
});
