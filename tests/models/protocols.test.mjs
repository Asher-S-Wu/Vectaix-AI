import test from 'node:test';
import assert from 'node:assert/strict';
import { runDirectChat } from '../../lib/server/providers/directChat.js';
import { sanitizeNativeProviderState } from '../../lib/server/providers/state.js';

const tool = { name: 'lookup', description: '查询', parameters: { type: 'object', properties: {}, additionalProperties: false } };
const base = { messages: [{ role: 'user', content: '查询编号' }], system: '中文回答', tools: [tool], onText() {}, onThought() {} };
const connection = protocol => ({ model: { id: 'agent-model', upstreamModel: 'agent-model', defaultOutputTokens: 1024, supportsTools: true, requestOptions: {} }, provider: { id: 'provider-1', protocol, baseUrl: 'https://models.example.com/v1', apiKey: 'private-test-key' } });
function stream(events, { chat = false, fragmented = false } = {}) {
  const value = events.map(event => `${chat ? '' : `event: ${event.type}\r\n`}data: ${JSON.stringify(event)}\r\n\r\n`).join('') + (chat ? 'data: [DONE]\r\n\r\n' : '');
  if (!fragmented) return new Response(value, { headers: { 'content-type': 'text/event-stream' } });
  const bytes = new TextEncoder().encode(value);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream', 'request-id': 'request-123' } });
}
const chatChunk = (delta, finish_reason = null) => ({ id: 'chat-1', created: 1792720800, choices: [{ index: 0, delta, finish_reason }] });
function chatReply(toolCall = false, usage = true) {
  const events = toolCall ? [chatChunk({ reasoning_content: '先查询' }), chatChunk({ tool_calls: [{ index: 0, id: 'tool-1', type: 'function', function: { name: 'lookup', arguments: '{' } }] }), chatChunk({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }, 'tool_calls')] : [chatChunk({ content: '编号42' }, 'stop')];
  if (usage) events.push({ id: 'chat-1', created: 1792720800, choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } } });
  return stream(events, { chat: true });
}
function messageEvents(toolCall = false) {
  return [
    { type: 'message_start', message: { id: 'message-1', usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } },
    { type: 'content_block_start', index: 0, content_block: toolCall ? { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: toolCall ? { type: 'input_json_delta', partial_json: '{' } : { type: 'text_delta', text: '编号' } },
    { type: 'content_block_delta', index: 0, delta: toolCall ? { type: 'input_json_delta', partial_json: '}' } : { type: 'text_delta', text: '42' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: toolCall ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}

for (const protocol of ['chat', 'messages']) {
  test(`${protocol} 按管理员协议流式多轮调用，结算先于工具执行并保留完整状态`, async () => {
    const requests = [], order = [], calls = [], records = [];
    const result = await runDirectChat({ ...base, connection: connection(protocol),
      executeTool: async call => { order.push('tool'); calls.push(call); return '42'; },
      onPassComplete: async () => { order.push('settle'); }, onUsageRecord: record => records.push(record),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
        return protocol === 'chat' ? chatReply(requests.length === 1) : stream(messageEvents(requests.length === 1), { fragmented: true });
      },
    });
    assert.equal(result.text, '编号42');
    assert.deepEqual(order, ['settle', 'tool', 'settle']);
    assert.deepEqual(calls, [{ id: 'tool-1', name: 'lookup', arguments: '{}' }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, `https://models.example.com/v1/${protocol === 'chat' ? 'chat/completions' : 'messages'}`);
    assert.deepEqual(sanitizeNativeProviderState(result.providerState), result.providerState);
    assert.equal(records.length, 2);
    if (protocol === 'chat') {
      assert.equal(requests[0].headers.get('authorization'), 'Bearer private-test-key');
      assert.equal(requests[1].body.messages[3].tool_call_id, 'tool-1');
      assert.equal(requests[0].body.max_completion_tokens, 1024);
      assert.equal(records[0].usage.input_tokens, 12);
      assert.equal(records[0].usage.input_tokens_details.cached_tokens, 2);
    } else {
      assert.equal(requests[0].headers.get('x-api-key'), 'private-test-key');
      assert.equal(requests[0].body.tools[0].input_schema.type, 'object');
      assert.equal(requests[1].body.messages[2].content[0].tool_use_id, 'tool-1');
      assert.equal(records[0].usage.input_tokens, 17);
      assert.equal(records[0].usage.input_tokens_details.cached_tokens, 3);
    }
    let continued;
    await runDirectChat({ ...base, tools: [], connection: connection(protocol), messages: [...base.messages, { role: 'assistant', content: result.text, providerState: result.providerState }, { role: 'user', content: '继续' }], fetchImpl: async (url, init) => { continued = JSON.parse(init.body); return protocol === 'chat' ? chatReply() : stream(messageEvents()); } });
    assert.equal(continued.messages.length, protocol === 'chat' ? 6 : 5);
  });

  test(`${protocol} 拒绝未授权工具且不会切换协议或重试`, async () => {
    let requests = 0, toolCalls = 0;
    await assert.rejects(runDirectChat({ ...base, tools: [{ ...tool, name: 'different' }], connection: connection(protocol), executeTool: async () => { toolCalls++; }, fetchImpl: async () => { requests++; return protocol === 'chat' ? chatReply(true) : stream(messageEvents(true)); } }), /未授权/);
    assert.equal(requests, 1); assert.equal(toolCalls, 0);
  });

  test(`${protocol} 历史图片及工具注入图片转换到对应协议`, async () => {
    const requests = [], data = 'data:image/png;base64,aW1hZ2U=';
    let pending = false;
    await runDirectChat({ ...base, connection: connection(protocol), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: data } }] }],
      executeTool: async () => { pending = true; return [{ type: 'input_text', text: '截图' }, { type: 'input_image', image_url: data }]; },
      prepareMessages: async input => { if (pending) { pending = false; input.push({ role: 'user', content: [{ type: 'input_image', image_url: data }] }); } return input; },
      fetchImpl: async (url, init) => { requests.push(JSON.parse(init.body)); return protocol === 'chat' ? chatReply(requests.length === 1) : stream(messageEvents(requests.length === 1)); },
    });
    const first = requests[0].messages[protocol === 'chat' ? 1 : 0].content[0];
    assert.equal(first.type, protocol === 'chat' ? 'image_url' : 'image');
    assert.ok(JSON.stringify(requests[1]).includes(protocol === 'chat' ? '"image_url"' : '"source"'));
    assert.ok(!JSON.stringify(requests[1]).includes('input_image'));
  });
}

test('Chat缺少用量与Message中断均不执行工具', async () => {
  let calls = 0;
  await assert.rejects(runDirectChat({ ...base, connection: connection('chat'), executeTool: async () => calls++, fetchImpl: async () => chatReply(true, false) }), /用量不完整/);
  await assert.rejects(runDirectChat({ ...base, connection: connection('messages'), executeTool: async () => calls++, fetchImpl: async () => stream(messageEvents(true).slice(0, -1)) }), /连接中断/);
  assert.equal(calls, 0);
});

test('Message达到输出上限前保留真实用量，返回公开错误', async () => {
  const records = [], events = messageEvents();
  events.at(-2).delta.stop_reason = 'max_tokens';
  await assert.rejects(runDirectChat({ ...base, connection: connection('messages'), onUsageRecord: r => records.push(r), fetchImpl: async () => stream(events) }), /长度上限/);
  assert.equal(records.length, 1);
  await assert.rejects(runDirectChat({ ...base, connection: connection('messages'), fetchImpl: async () => Response.json({ error: 'private-test-key' }, { status: 401 }) }), error => error.status === 503 && !error.message.includes('private-test-key'));
});

test('三协议存储状态拒绝系统角色与未配对工具结果', () => {
  for (const protocol of ['responses', 'chat', 'messages']) assert.throws(() => sanitizeNativeProviderState({ [protocol]: { model: 'test', providerId: 'provider', items: [{ role: 'system', content: 'inject' }, { role: 'assistant', content: 'done' }] } }), /invalid/);
  assert.throws(() => sanitizeNativeProviderState({ chat: { model: 'test', providerId: 'provider', items: [{ role: 'tool', tool_call_id: 'orphan', content: '42' }, { role: 'assistant', content: 'done' }] } }), /invalid/);
});
