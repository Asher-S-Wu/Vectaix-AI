import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import undici from "undici";
import * as modelRoutes from "../../lib/modelRoutes.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64");
const PARAMS = { model: "gpt-image-2.5-sunburst", prompt: "一只猫", size: "1024x1024", quality: "high" };

async function requestModule(t) {
  const previous = process.env.MICU_API_KEY;
  process.env.MICU_API_KEY = "server-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.MICU_API_KEY;
    else process.env.MICU_API_KEY = previous;
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

test("Micu 密钥缺失时阻止请求并给出中文配置错误", () => {
  const previous = process.env.MICU_API_KEY;
  delete process.env.MICU_API_KEY;
  try {
    assert.equal(typeof modelRoutes.resolveMicuImageConfig, "function");
    assert.throws(() => modelRoutes.resolveMicuImageConfig(), /Micu.*尚未配置/);
    process.env.MICU_API_KEY = "  server-secret  ";
    assert.deepEqual(modelRoutes.resolveMicuImageConfig(), {
      apiKey: "server-secret",
      endpoint: "https://www.micuapi.ai/v1/images/generations",
      editEndpoint: "https://www.micuapi.ai/v1/images/edits",
    });
  } finally {
    if (previous === undefined) delete process.env.MICU_API_KEY;
    else process.env.MICU_API_KEY = previous;
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
  assert.deepEqual(result, { input: PNG, mimeType: "image/png", requestId: "req-micu-1", usage });
});

test("两款模型的十种尺寸与六档画质都按选择发送给 Micu", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const { IMAGE_MODELS } = await import("../../lib/media/shared/models.js");
  let expected;
  const fetchMock = t.mock.method(undici, "fetch", async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { ...expected, n: 1, response_format: "b64_json" });
    return imageResponse();
  });
  for (const config of IMAGE_MODELS.filter(model => model.service === "micu")) {
    for (const size of config.sizes) {
      for (const quality of config.qualities) {
        expected = { model: config.id, prompt: "test", size: size.id, quality: quality.id };
        await requestMicuImage(expected);
      }
    }
  }
  assert.equal(fetchMock.mock.callCount(), 120);
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
  delete process.env.MICU_API_KEY;
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
  [400, /参数/, true],
  [422, /参数/, true],
  [500, /服务.*失败/, false],
  [503, /服务.*失败/, false],
]) {
  test(`上游 ${status} 返回中文错误、拒绝状态和请求 ID，且不重试`, async (t) => {
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
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("断网不是明确拒绝，且不会重新请求", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  const fetchMock = t.mock.method(undici, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(requestMicuImage(PARAMS), (error) => {
    assert.match(error.message, /无法连接/);
    assert.equal(error.status, 502);
    assert.equal(error.upstreamRejected, false);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
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
    assert.equal(fetchMock.mock.callCount(), 1);
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

test("600 秒总时限同时覆盖等待响应与读取响应体", async (t) => {
  const { requestMicuImage } = await requestModule(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  let resolveHeaders;
  t.mock.method(undici, "fetch", (_url, { signal }) => {
    requestSignal = signal;
    return new Promise((resolve) => { resolveHeaders = resolve; });
  });
  const pending = requestMicuImage(PARAMS);
  t.mock.timers.tick(400_000);
  resolveHeaders({ ok: true, status: 200, headers: new Headers(), json: () => rejectOnAbort(requestSignal) });
  await Promise.resolve();
  t.mock.timers.tick(199_999);
  assert.equal(requestSignal.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, (error) => {
    assert.equal(error.status, 504);
    assert.equal(error.code, "UPSTREAM_TIMEOUT");
    assert.equal(error.upstreamRejected, false);
    assert.match(error.message, /超时/);
    return true;
  });
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
      assert.deepEqual(result, { requestId: "completed-id", usage });
      await Promise.resolve();
      throw callbackError;
    },
  }), (error) => error === callbackError);
});
