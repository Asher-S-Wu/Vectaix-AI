import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import undici from "undici";
import timers from "node:timers/promises";

test.beforeEach(t => { t.mock.method(timers, "setTimeout", async () => {}); });
import * as modelRoutes from "../../lib/modelRoutes.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64");
const PARAMS = { model: "gpt-image-2.5-sunburst", prompt: "一只猫", size: "1024x1024", quality: "low" };

async function requestModule(t) {
  const previous = process.env.MICU_OPENAI_IMAGE_API_KEY;
  process.env.MICU_OPENAI_IMAGE_API_KEY = "server-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.MICU_OPENAI_IMAGE_API_KEY;
    else process.env.MICU_OPENAI_IMAGE_API_KEY = previous;
  });
  return import("../../lib/media/server/micuImage.js");
}

function imageResponse(extra = {}) {
  return Response.json({ data: [{ b64_json: PNG.toString("base64") }], ...extra });
}

function rejectOnAbort(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("Micu 使用实际 HTTP 连接完成文生图及单图、多图表单请求", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(200, { "content-type": "application/json", "x-request-id": "real-http-test" });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const originalDispatch = undici.Agent.prototype.dispatch;
  t.mock.method(undici.Agent.prototype, "dispatch", function (options, handler) {
    assert.equal(options.headersTimeout, 600_000);
    assert.equal(options.bodyTimeout, 600_000);
    return originalDispatch.call(this, { ...options, origin }, handler);
  });
  for (const count of [0, 1, 2]) {
    const images = Array.from({ length: count }, (_, index) => new File([PNG], `参考-${index}.png`, { type: "image/png" }));
    const result = await requestMicuImage({ ...PARAMS, images, signal: AbortSignal.timeout(5000) });
    assert.deepEqual(result.input, PNG);
    assert.equal(result.requestId, "real-http-test");
    const sent = received[count];
    assert.equal(sent.url, `/v1/images/${count ? "edits" : "generations"}`);
    assert.equal(sent.headers.authorization, "Bearer server-secret");
    if (count === 0) {
      assert.deepEqual(JSON.parse(sent.body), { ...PARAMS, n: 1, response_format: "b64_json" });
    } else {
      const data = await new Response(sent.body, { headers: { "content-type": sent.headers["content-type"] } }).formData();
      const field = count === 1 ? "image" : "image[]";
      assert.equal(data.getAll(field).length, count);
      assert.equal(data.getAll(count === 1 ? "image[]" : "image").length, 0);
      assert.equal(data.get("prompt"), PARAMS.prompt);
      assert.equal(data.get("quality"), PARAMS.quality);
      assert.equal(data.get("response_format"), "b64_json");
      assert.deepEqual(Buffer.from(await data.get(field).arrayBuffer()), PNG);
    }
  }
  assert.equal(received.length, 3);
});

test("Micu 图片密钥独立于 GPT，缺失时阻止请求并给出中文配置错误", () => {
  const previous = process.env.MICU_OPENAI_IMAGE_API_KEY;
  const previousChatKey = process.env.MICU_OPENAI_API_KEY;
  delete process.env.MICU_OPENAI_IMAGE_API_KEY;
  process.env.MICU_OPENAI_API_KEY = "chat-only-secret";
  try {
    assert.equal(typeof modelRoutes.resolveMicuImageConfig, "function");
    assert.throws(() => modelRoutes.resolveMicuImageConfig(), /Micu.*尚未配置/);
    process.env.MICU_OPENAI_IMAGE_API_KEY = "  server-secret  ";
    assert.deepEqual(modelRoutes.resolveMicuImageConfig(), {
      apiKey: "server-secret",
      endpoint: "https://www.micuapi.ai/v1/images/generations",
      editEndpoint: "https://www.micuapi.ai/v1/images/edits",
    });
  } finally {
    if (previous === undefined) delete process.env.MICU_OPENAI_IMAGE_API_KEY;
    else process.env.MICU_OPENAI_IMAGE_API_KEY = previous;
    if (previousChatKey === undefined) delete process.env.MICU_OPENAI_API_KEY;
    else process.env.MICU_OPENAI_API_KEY = previousChatKey;
  }
});

test("文生图只发一次 JSON 请求并解码图片、保留用量和真实请求 ID", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const usage = { input_tokens: 23, output_tokens: 120, input_tokens_details: { image_tokens: 3 } };
  const calls = [];
  let dispatched = 0;
  t.mock.method(undici, "fetch", async (url, options) => {
    calls.push({ url, options });
    return imageResponse({ request_id: "req-micu-1", usage });
  });
  const result = await requestMicuImage({ ...PARAMS, onRequestDispatched: () => dispatched++ });
  assert.equal(calls.length, 1);
  assert.equal(dispatched, 1);
  assert.equal(calls[0].url, "https://www.micuapi.ai/v1/images/generations");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-secret");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ...PARAMS, n: 1, response_format: "b64_json",
  });
  assert.deepEqual(result, { input: PNG, mimeType: "image/png", requestId: "req-micu-1", usage, attempts: [{ success: true, requestId: "req-micu-1", usage }] });
});

test("两款模型的十四种尺寸选项均固定发送 low 给 Micu", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const { IMAGE_MODELS } = await import("../../lib/media/shared/models.js");
  let expected;
  const fetchMock = t.mock.method(undici, "fetch", async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { ...expected, n: 1, response_format: "b64_json" });
    return imageResponse();
  });
  for (const config of IMAGE_MODELS.filter(model => model.service === "micu")) {
    for (const size of config.sizes) {
      expected = { model: config.id, prompt: "test", size: size.id, quality: "low" };
      await requestMicuImage(expected);
    }
  }
  assert.equal(fetchMock.mock.callCount(), 28);
});

test("生成、单图和多图编辑忽略旧画质参数，两款模型只发送 low 且不重试", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  let expectedModel;
  let expectedCount;
  const fetchMock = t.mock.method(undici, "fetch", async (url, options) => {
    const input = expectedCount ? Object.fromEntries(options.body.entries()) : JSON.parse(options.body);
    assert.equal(input.model, expectedModel);
    assert.equal(input.quality, "low");
    assert.equal(url, `https://www.micuapi.ai/v1/images/${expectedCount ? "edits" : "generations"}`);
    return imageResponse();
  });
  for (const model of ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]) {
    expectedModel = model;
    for (const count of [0, 1, 2]) {
      expectedCount = count;
      const images = Array.from({ length: count }, (_, i) => new File([PNG], `${i}.png`, { type: "image/png" }));
      for (const quality of [undefined, "auto", "medium", "high", "xhigh", "max"]) {
        await requestMicuImage({ ...PARAMS, model, quality, images });
      }
    }
  }
  assert.equal(fetchMock.mock.callCount(), 36);
});

for (const count of [1, 2]) {
  test(`${count} 张参考图使用正确 multipart 图片字段并只请求一张输出`, async (t) => {
    const { requestMicuImage } = await requestModule(t);
    const images = Array.from({ length: count }, (_, i) => new File([PNG], `source-${i}.png`, { type: "image/png" }));
    let calls = 0;
    t.mock.method(undici, "fetch", async (url, options) => {
      calls++;
      assert.equal(url, "https://www.micuapi.ai/v1/images/edits");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer server-secret");
      assert.equal(options.headers["Content-Type"], undefined);
      assert.ok(options.body instanceof undici.FormData);
      for (const [key, value] of Object.entries(PARAMS)) assert.equal(options.body.get(key), value);
      assert.equal(options.body.get("n"), "1");
      assert.equal(options.body.get("response_format"), "b64_json");
      const field = count === 1 ? "image" : "image[]";
      const uploaded = options.body.getAll(field);
      assert.equal(options.body.getAll(count === 1 ? "image[]" : "image").length, 0);
      assert.equal(uploaded.length, count);
      for (let i = 0; i < uploaded.length; i++) {
        assert.equal(uploaded[i].name, `source-${i}.png`);
        assert.equal(uploaded[i].type, "image/png");
        assert.deepEqual(Buffer.from(await uploaded[i].arrayBuffer()), PNG);
      }
      return imageResponse();
    });
    const result = await requestMicuImage({ ...PARAMS, images });
    assert.equal(calls, 1);
    assert.equal(result.requestId, undefined);
    assert.equal(result.usage, undefined);
  });
}

test("返回实际 JPEG/WebP 内容时按真实类型保存，不使用响应自报类型", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const fixtures = [
    { input: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), mimeType: "image/jpeg" },
    { input: Buffer.from("52494646120000005745425056503820060000009d012a01000100", "hex"), mimeType: "image/webp" },
  ];
  for (const fixture of fixtures) {
    const fetchMock = t.mock.method(undici, "fetch", async () => Response.json({
      data: [{ b64_json: fixture.input.toString("base64"), mime_type: "image/png" }],
    }, { headers: { "x-request-id": "header-id" } }));
    const result = await requestMicuImage(PARAMS);
    assert.deepEqual(result.input, fixture.input);
    assert.equal(result.mimeType, fixture.mimeType);
    assert.equal(result.requestId, "header-id");
    fetchMock.mock.restore();
  }
});

test("正常大小的图片 base64 不会因编码验证导致栈溢出", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const input = Buffer.alloc(8 * 1024 * 1024);
  PNG.copy(input);
  t.mock.method(undici, "fetch", async () => Response.json({ data: [{ b64_json: input.toString("base64") }] }));
  const result = await requestMicuImage(PARAMS);
  assert.deepEqual(result.input, input);
  assert.equal(result.mimeType, "image/png");
});

test("网络请求不会被 fetch 默认五分钟超时提前截断", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const { Agent } = await import("undici");
  let captured;
  t.mock.method(Agent.prototype, "dispatch", (options) => { captured = options; return true; });
  t.mock.method(undici, "fetch", async (_url, options) => {
    options.dispatcher.dispatch({ headersTimeout: 300_000, bodyTimeout: 300_000 }, {});
    return imageResponse();
  });
  await requestMicuImage(PARAMS);
  assert.equal(captured.headersTimeout, 600_000);
  assert.equal(captured.bodyTimeout, 600_000);
});

test("服务未配置时不发送任何网络请求", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  delete process.env.MICU_OPENAI_IMAGE_API_KEY;
  const fetchMock = t.mock.method(undici, "fetch", async () => imageResponse());
  await assert.rejects(requestMicuImage(PARAMS), (error) => {
    assert.match(error.message, /Micu.*尚未配置/);
    assert.equal(error.status, 503);
    assert.equal(error.code, "SERVICE_NOT_CONFIGURED");
    assert.equal(error.requestId, undefined);
    assert.equal(error.upstreamRejected, false);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

for (const [status, expectedMessage, rejected] of [
  [401, /密钥.*无效/, true],
  [403, /权限/, true],
  [429, /频繁/, true],
  [400, /拒绝/, true],
  [422, /拒绝/, true],
  [500, /服务.*失败/, false],
  [503, /服务.*失败/, false],
]) {
  test(`上游 ${status} 返回中文错误、拒绝状态和请求 ID，按错误类型决定重试`, async (t) => {
    const { requestMicuImage } = await requestModule(t);
    const fetchMock = t.mock.method(undici, "fetch", async () => Response.json({
      error: { code: "upstream_code", message: "upstream details" }, request_id: "failed-request",
    }, { status }));
    await assert.rejects(requestMicuImage(PARAMS), (error) => {
      assert.match(error.message, expectedMessage);
      assert.equal(error.status, status);
      assert.equal(error.code, "upstream_code");
      assert.equal(error.requestId, "failed-request");
      assert.equal(error.upstreamRejected, rejected);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), [429, 500, 503].includes(status) ? 5 : 1);
  });
}

for (const [label, responseBody, expectedStatus, expectedMessage] of [
  ["具体参数错误", { error: { message: "Unsupported value for size: auto", type: "invalid_request_error", param: "size" } }, 400, /Unsupported value for size: auto/],
  ["被包装成 400 的限流", { error: { message: "upstream: Too Many Requests" } }, 429, /请求过于频繁/],
  ["顶层限流消息", { message: "rate_limit_exceeded" }, 429, /请求过于频繁/],
  ["内容拒绝", { error: { message: "Request rejected by safety system", code: "moderation_blocked" } }, 400, /Request rejected by safety system/],
  ["纯文本限流", "upstream: Too Many Requests", 429, /请求过于频繁/],
]) {
  test(`Micu ${label}保留真实原因、请求编号和参数，按错误类型决定重试`, async (t) => {
    const { requestMicuImage } = await requestModule(t);
    const log = t.mock.method(console, "error", () => {});
    const fetchMock = t.mock.method(undici, "fetch", async () => new Response(
      typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
      { status: 400, headers: { "x-request-id": "rejected-request" } },
    ));
    await assert.rejects(requestMicuImage(PARAMS), (error) => {
      assert.equal(error.status, expectedStatus);
      assert.equal(error.upstreamStatus, 400);
      assert.equal(error.upstreamRejected, true);
      assert.equal(error.requestId, "rejected-request");
      assert.match(error.message, expectedMessage);
      if (expectedStatus === 429) assert.equal(error.code, "UPSTREAM_RATE_LIMITED");
      if (responseBody.error?.param) {
        assert.equal(error.upstreamType, "invalid_request_error");
        assert.equal(error.upstreamParam, "size");
      }
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), expectedStatus === 429 ? 5 : 1);
    assert.equal(log.mock.callCount(), expectedStatus === 429 ? 5 : 1);
    const [label, details] = log.mock.calls[0].arguments;
    assert.equal(label, "[Micu Image] request failed:");
    for (const key of ["model", "size", "quality"]) assert.equal(details[key], PARAMS[key]);
    assert.equal(details.inputImageCount, 0);
    assert.equal(details.upstreamStatus, 400);
    assert.equal(details.requestId, "rejected-request");
    assert.ok(!Object.hasOwn(details, "prompt"));
  });
}

test("Micu 拒绝详情隐藏密钥并限制长度", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const log = t.mock.method(console, "error", () => {});
  t.mock.method(undici, "fetch", async () => Response.json({ error: {
    message: `Invalid key server-secret; Authorization: Bearer upstream-private-token; sk-provider-secret; ${"detail ".repeat(300)}`,
  } }, { status: 400 }));
  await assert.rejects(requestMicuImage(PARAMS), (error) => {
    assert.match(error.message, /Invalid key/);
    assert.doesNotMatch(error.message, /server-secret|upstream-private-token|sk-provider-secret/);
    assert.ok(error.upstreamMessage.length <= 800);
    return true;
  });
  assert.doesNotMatch(JSON.stringify(log.mock.calls[0].arguments), /server-secret|upstream-private-token|sk-provider-secret/);
});

test("断网不是明确拒绝，五次失败后返回错误", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const fetchMock = t.mock.method(undici, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(requestMicuImage(PARAMS), (error) => {
    assert.match(error.message, /无法连接/);
    assert.equal(error.status, 502);
    assert.equal(error.upstreamRejected, false);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 5);
});

for (const [label, body] of [
  ["没有结果", { data: [] }],
  ["只返回 URL", { data: [{ url: "https://example.com/image.png" }] }],
  ["错误 base64", { data: [{ b64_json: `${PNG.toString("base64")}!` }] }],
  ["伪装图片", { data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }],
]) {
  test(`${label}时明确报错，不下载 URL 或猜测结果`, async (t) => {
    const { requestMicuImage } = await requestModule(t);
    const fetchMock = t.mock.method(undici, "fetch", async () => Response.json({ ...body, request_id: "bad-result" }));
    await assert.rejects(requestMicuImage(PARAMS), (error) => {
      assert.match(error.message, /图片|结果/);
      assert.equal(error.status, 502);
      assert.equal(error.code, "INVALID_UPSTREAM_RESPONSE");
      assert.equal(error.requestId, "bad-result");
      assert.equal(error.upstreamRejected, false);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 5);
  });
}

test("非 JSON 的 4xx 响应仍保留明确拒绝状态", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  t.mock.method(undici, "fetch", async () => new Response("Access denied", {
    status: 403, headers: { "x-request-id": "denied-id" },
  }));
  await assert.rejects(requestMicuImage(PARAMS), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.requestId, "denied-id");
    assert.equal(error.upstreamRejected, true);
    assert.match(error.message, /权限/);
    return true;
  });
});

test("已取消请求不发送，进行中的请求会取消", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const fetchMock = t.mock.method(undici, "fetch", (_url, { signal }) => rejectOnAbort(signal));
  const before = new AbortController();
  before.abort();
  await assert.rejects(requestMicuImage({ ...PARAMS, signal: before.signal }), { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 0);
  const during = new AbortController();
  const pending = requestMicuImage({ ...PARAMS, signal: during.signal });
  during.abort(new Error("user cancelled"));
  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.upstreamRejected, false);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("每次尝试的 600 秒时限覆盖等待响应和读取响应体", async t => {
  const { requestMicuImage } = await requestModule(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(timers, "setTimeout", async () => {});
  let requestSignal, resolveHeaders;
  t.mock.method(undici, "fetch", (_url, { signal }) => {
    requestSignal = signal;
    return new Promise(resolve => { resolveHeaders = resolve; });
  });
  const pending = assert.rejects(requestMicuImage(PARAMS), error => {
    assert.equal(error.status, 504);
    assert.equal(error.code, "UPSTREAM_TIMEOUT");
    assert.equal(error.attempts.length, 5);
    return true;
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    t.mock.timers.tick(400_000);
    resolveHeaders({ ok: true, status: 200, headers: new Headers(), json: () => rejectOnAbort(requestSignal) });
    await Promise.resolve();
    t.mock.timers.tick(199_999);
    assert.equal(requestSignal.aborted, false);
    t.mock.timers.tick(1);
    await new Promise(resolve => setImmediate(resolve));
  }
  await pending;
});

test("保存前等待完成回调，回调失败时不保存图片", async (t) => {
  const { generateAndStoreMicuImageFile } = await requestModule(t);
  const usage = { output_tokens: 12 };
  t.mock.method(undici, "fetch", async () => imageResponse({ request_id: "completed-id", usage }));
  const callbackError = new Error("callback failed");
  await assert.rejects(generateAndStoreMicuImageFile({
    ...PARAMS,
    userId: "invalid-owner-would-fail-if-storage-runs-first",
    onUpstreamComplete: async (result) => {
      assert.deepEqual(result, { requestId: "completed-id", usage, attempts: [{ success: true, requestId: "completed-id", usage }] });
      await Promise.resolve();
      throw callbackError;
    },
  }), (error) => error === callbackError);
});

test('临时错误按 1、2、4、8 秒重试，五次失败保留全部请求记录', async t => {
  const { default: timers } = await import('node:timers/promises');
  const waits = [];
  t.mock.method(timers, 'setTimeout', async ms => { waits.push(ms); });
  const { requestMicuImage } = await requestModule(t);
  let calls = 0;
  t.mock.method(undici, 'fetch', async () => Response.json({ error: { message: 'temporarily unavailable' }, request_id: `attempt-${++calls}` }, { status: 503 }));
  t.mock.method(console, 'error', () => {});
  await assert.rejects(requestMicuImage(PARAMS), error => {
    assert.equal(calls, 5);
    assert.equal(error.attempts.length, 5);
    assert.deepEqual(error.attempts.map(item => item.requestId), ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4', 'attempt-5']);
    return true;
  });
  assert.deepEqual(waits, [1000, 2000, 4000, 8000]);
});

test('网络失败后成功保留不确定尝试；余额不足即使 429 也不重试', async t => {
  const { default: timers } = await import('node:timers/promises');
  t.mock.method(timers, 'setTimeout', async () => {});
  const { requestMicuImage } = await requestModule(t);
  let calls = 0;
  t.mock.method(undici, 'fetch', async () => {
    if (++calls === 1) throw new TypeError('fetch failed');
    return imageResponse({ request_id: 'success' });
  });
  const result = await requestMicuImage(PARAMS);
  assert.deepEqual(result.input, PNG);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].upstreamRejected, false);
  assert.equal(result.attempts[1].success, true);
  calls = 0;
  t.mock.method(undici, 'fetch', async () => { calls++; return Response.json({ error: { code: 'insufficient_quota', message: 'insufficient balance' } }, { status: 429 }); });
  await assert.rejects(requestMicuImage(PARAMS), /insufficient balance/);
  assert.equal(calls, 1);
});

test('等待重试时取消，立即停止且不发下一次请求', async t => {
  const { requestMicuImage } = await requestModule(t);
  const controller = new AbortController();
  let enteredWait;
  const waiting = new Promise(resolve => { enteredWait = resolve; });
  t.mock.method(timers, 'setTimeout', (_ms, _value, { signal }) => { enteredWait(); return rejectOnAbort(signal); });
  const upstream = t.mock.method(undici, 'fetch', async () => { throw new TypeError('network failure'); });
  const pending = assert.rejects(requestMicuImage({ ...PARAMS, signal: controller.signal }), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.attempts.length, 1);
    assert.equal(error.attempts[0].upstreamRejected, false);
    return true;
  });
  await waiting;
  controller.abort();
  await pending;
  assert.equal(upstream.mock.callCount(), 1);
});

test('收到图片后取消时停止保存，不再发出图片请求', async t => {
  const { generateAndStoreMicuImageFile } = await requestModule(t);
  const controller = new AbortController();
  const upstream = t.mock.method(undici, 'fetch', async () => imageResponse());
  await assert.rejects(generateAndStoreMicuImageFile({ ...PARAMS, userId: 'not-a-valid-storage-owner', signal: controller.signal, onUpstreamComplete: () => controller.abort() }), { name: 'AbortError' });
  assert.equal(upstream.mock.callCount(), 1);
});
