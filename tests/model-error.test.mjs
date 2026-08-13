import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  // jiti 把 .ts 编译为 CJS 后，ESM import() 的命名导出会折叠到 default 对象上。
  // 兼容 default 与非 default 两种形态，避免依赖宿主 jiti/Node 的 interop 细节。
  const mod = await import(new URL("../lib/model-error.ts", import.meta.url).href);
  return mod.default ?? mod;
}

test("parseModelError extracts HTTP status prefix from gateway body", async () => {
  const { parseModelError } = await loadModule();
  const parsed = parseModelError('500 {"code":"get_channel_failed"}');
  assert.equal(parsed.status, 500);
  assert.equal(parsed.code, "get_channel_failed");
});

test("parseModelError handles bare gateway JSON body", async () => {
  const { parseModelError } = await loadModule();
  const parsed = parseModelError('{"code":"get_channel_failed"}');
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.code, "get_channel_failed");
  // 只有 code、没有 message 字段时不应生成冗余 message
  assert.equal(parsed.message, undefined);
});

test("parseModelError handles OpenAI-style error envelope", async () => {
  const { parseModelError } = await loadModule();
  const parsed = parseModelError(
    '401 {"error":{"message":"Incorrect API key","type":"invalid_request_error","code":"invalid_api_key"}}'
  );
  assert.equal(parsed.status, 401);
  assert.equal(parsed.code, "invalid_api_key");
  assert.equal(parsed.message, "Incorrect API key");
});

test("parseModelError handles error-as-string body", async () => {
  const { parseModelError } = await loadModule();
  const parsed = parseModelError('500 {"error":"internal_server_error"}');
  assert.equal(parsed.status, 500);
  assert.equal(parsed.code, "internal_server_error");
});

test("parseModelError treats plain text as message", async () => {
  const { parseModelError } = await loadModule();
  const parsed = parseModelError("fetch failed");
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.message, "fetch failed");
});

test("parseModelError handles empty input", async () => {
  const { parseModelError } = await loadModule();
  const parsed = parseModelError("");
  assert.equal(parsed.message, "");
});

test("friendlyModelErrorHint maps gateway error codes to channel hint", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = '{"code":"get_channel_failed"}';
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /模型渠道暂不可用/);
});

test("friendlyModelErrorHint maps HTTP 500 to gateway hint", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = '500 {"error":"internal_server_error"}';
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /网关故障或过载/);
});

test("friendlyModelErrorHint maps balance/quota language", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = "insufficient_quota";
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /余额不足或额度用尽/);
});

test("friendlyModelErrorHint maps rate limit", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = "429 too many requests";
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /限流/);
});

test("friendlyModelErrorHint maps auth failures", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = '401 {"error":{"message":"Incorrect API key","code":"invalid_api_key"}}';
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /鉴权失败/);
});

test("friendlyModelErrorHint maps network errors", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = "fetch failed: ECONNRESET";
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /网络异常或请求超时/);
});

test("friendlyModelErrorHint falls back to generic hint", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  const raw = "some unknown mystery failure";
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.equal(hint, "模型请求失败。");
});

test("gateway hint outranks generic text inside raw body", async () => {
  const { parseModelError, friendlyModelErrorHint } = await loadModule();
  // 即便正文里没出现关键词，HTTP 500 也应归类到网关故障
  const raw = '500 {"errno":-1}';
  const hint = friendlyModelErrorHint(parseModelError(raw), raw);
  assert.match(hint, /网关故障或过载/);
});