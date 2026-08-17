import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  // jiti 把 .ts 编译为 CJS 后，ESM import() 的命名导出会折叠到 default 对象上。
  // 兼容 default 与非 default 两种形态，避免依赖宿主 jiti/Node 的 interop 细节。
  const mod = await import(new URL("../lib/api-key-guard.ts", import.meta.url).href);
  return mod.default ?? mod;
}

test("accepts a normal real-world API key", async () => {
  const { validateApiKeyValue } = await loadModule();
  const inputs = [
    "sk-3e8402395d074c849b90b3293efa8a53.LtKw3dHDylRzPsAT",
    "sk-" + "x".repeat(48),
    "a1b2c3d4e5f6a7b8",
  ];
  for (const input of inputs) {
    const r = validateApiKeyValue(input);
    assert.equal(r.ok, true, `should accept ${input}, got ${JSON.stringify(r)}`);
  }
});

test("trims surrounding whitespace but not inner", async () => {
  const { validateApiKeyValue } = await loadModule();
  const r = validateApiKeyValue("  sk-valid-key-1234  ");
  assert.equal(r.ok, true);
});

test("rejects a Chinese sentence (the reported dirty value)", async () => {
  const { validateApiKeyValue } = await loadModule();
  const dirty = "我必须得说  web上还是有很多bug   就是在会话列表上,经常刷新不及时   状态显示不及时";
  const r = validateApiKeyValue(dirty);
  assert.equal(r.ok, false);
  assert.equal(r.code, "NOT_API_KEY");
});

test("rejects any CJK content even without spaces", async () => {
  const { validateApiKeyValue } = await loadModule();
  const r = validateApiKeyValue("abc中文xyz");
  assert.equal(r.ok, false);
  assert.equal(r.code, "NOT_API_KEY");
});

test("rejects multi-token / space-separated text", async () => {
  const { validateApiKeyValue } = await loadModule();
  for (const input of ["sk-abc 1234defg", "some key with spaces value"]) {
    const r = validateApiKeyValue(input);
    assert.equal(r.ok, false, `should reject ${input}`);
    assert.equal(r.code, "NOT_API_KEY");
  }
});

test("rejects empty and whitespace-only", async () => {
  const { validateApiKeyValue } = await loadModule();
  assert.equal(validateApiKeyValue("").code, "EMPTY");
  assert.equal(validateApiKeyValue("   \t ").code, "EMPTY");
});

test("rejects control characters / newlines", async () => {
  const { validateApiKeyValue } = await loadModule();
  assert.equal(validateApiKeyValue("sk-abc\ndefghij").code, "CONTROL");
  assert.equal(validateApiKeyValue("sk-abc\u0001defghij").code, "CONTROL");
});

test("rejects too-short values", async () => {
  const { validateApiKeyValue } = await loadModule();
  const { MIN_API_KEY_LENGTH } = await loadModule();
  assert.equal(validateApiKeyValue("short").code, "TOO_SHORT");
  // 恰好等于最小长度应通过
  assert.equal(
    validateApiKeyValue("1".repeat(MIN_API_KEY_LENGTH)).ok,
    true,
  );
  assert.equal(
    validateApiKeyValue("1".repeat(MIN_API_KEY_LENGTH - 1)).code,
    "TOO_SHORT",
  );
});