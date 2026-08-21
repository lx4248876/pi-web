import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  // jiti 把 .ts 编译为 CJS 后，ESM import() 的命名导出会折叠到 default 对象上。
  // 兼容 default 与非 default 两种形态（同 tests/models-config-test-connection.test.mjs）。
  const mod = await import(
    new URL("../lib/compaction-override.ts", import.meta.url).href
  );
  return mod.default ?? mod;
}

// ── resolveCompactionOverride：阈值 → pi compaction overrides ────────────────

test("有效阈值 + 有效 contextWindow → enabled:true 且 reserveTokens = contextWindow - threshold", async () => {
  const { resolveCompactionOverride } = await loadModule();
  const r = resolveCompactionOverride({
    autoCompactThreshold: 80000,
    contextWindow: 128000,
  });
  assert.deepStrictEqual(r, { enabled: true, reserveTokens: 48000 });
});

test("阈值未填 / 0 / 负数 / 小数 → enabled:false（不开启自动压缩）", async () => {
  const { resolveCompactionOverride } = await loadModule();
  for (const bad of [undefined, null, 0, -100, 12.5, "80000", NaN]) {
    const r = resolveCompactionOverride({
      autoCompactThreshold: bad,
      contextWindow: 128000,
    });
    assert.deepStrictEqual(
      r,
      { enabled: false },
      `threshold=${String(bad)} 应判为未配置`,
    );
  }
});

test("contextWindow 缺失 / 非正 → enabled:false", async () => {
  const { resolveCompactionOverride } = await loadModule();
  for (const bad of [undefined, null, 0, -1]) {
    const r = resolveCompactionOverride({
      autoCompactThreshold: 80000,
      contextWindow: bad,
    });
    assert.deepStrictEqual(
      r,
      { enabled: false },
      `contextWindow=${String(bad)} 应判为不可启用`,
    );
  }
});

test("阈值 >= contextWindow → enabled:false（reserveTokens 会 <=0，视为无效配置）", async () => {
  const { resolveCompactionOverride } = await loadModule();
  assert.deepStrictEqual(
    resolveCompactionOverride({
      autoCompactThreshold: 128000,
      contextWindow: 128000,
    }),
    { enabled: false },
  );
  assert.deepStrictEqual(
    resolveCompactionOverride({
      autoCompactThreshold: 200000,
      contextWindow: 128000,
    }),
    { enabled: false },
  );
});

// ── applyCompactionOverride：把结果写进 settingsManager（含「没填=关闭」） ──

test("applyCompactionOverride 有效阈值 → applyOverrides 收到 enabled:true + 换算后的 reserveTokens", async () => {
  const { applyCompactionOverride } = await loadModule();
  const calls = [];
  const fakeManager = { applyOverrides: (o) => calls.push(o) };
  applyCompactionOverride(fakeManager, {
    contextWindow: 128000,
    autoCompactThreshold: 100000,
  });
  assert.equal(calls.length, 1);
  assert.deepStrictEqual(calls[0], {
    compaction: { enabled: true, reserveTokens: 28000 },
  });
});

test("applyCompactionOverride 没填阈值 → 也要 applyOverrides enabled:false（覆盖 pi 默认开启）", async () => {
  const { applyCompactionOverride } = await loadModule();
  const calls = [];
  const fakeManager = { applyOverrides: (o) => calls.push(o) };
  applyCompactionOverride(fakeManager, {
    contextWindow: 128000,
    autoCompactThreshold: undefined,
  });
  assert.equal(calls.length, 1, "没填也必须显式关闭，否则 pi 默认 enabled:true 会漏进来");
  assert.deepStrictEqual(calls[0], { compaction: { enabled: false } });
});

test("applyCompactionOverride model 为 undefined → 不调用 applyOverrides（无从判断模型）", async () => {
  const { applyCompactionOverride } = await loadModule();
  const calls = [];
  const fakeManager = { applyOverrides: (o) => calls.push(o) };
  applyCompactionOverride(fakeManager, undefined);
  assert.equal(calls.length, 0);
});

// ── readAutoCompactThreshold：从 models.json 条目读原始阈值 ──────────────────

test("readAutoCompactThreshold 经注入读取器找到模型条目并返回阈值", async () => {
  const { readAutoCompactThreshold } = await loadModule();
  const fakeReader = (provider, modelId) =>
    provider === "my-relay" && modelId === "gpt-x"
      ? { id: "gpt-x", autoCompactThreshold: 80000 }
      : undefined;
  assert.equal(
    readAutoCompactThreshold("my-relay", "gpt-x", fakeReader),
    80000,
  );
  assert.equal(
    readAutoCompactThreshold("my-relay", "not-exist", fakeReader),
    undefined,
  );
  // 读取器抛错 / 返回垃圾 → 视为未配置（不让 models.json 损坏炸掉会话）
  assert.equal(
    readAutoCompactThreshold("x", "y", () => {
      throw new Error("boom");
    }),
    undefined,
  );
  assert.equal(
    readAutoCompactThreshold("x", "y", () => null),
    undefined,
  );
});

test("readAutoCompactThreshold 条目里无该字段 / 非数字 → undefined", async () => {
  const { readAutoCompactThreshold } = await loadModule();
  const fakeReader = () => ({ id: "m", autoCompactThreshold: "abc" });
  assert.equal(readAutoCompactThreshold("p", "m", fakeReader), undefined);
});

// ── assertNotCompacting：压缩中拦截（rpc-manager prompt/steer/follow_up 用） ──

test("assertNotCompacting isCompacting=true → throw 中文错误；false → 通过", async () => {
  const { assertNotCompacting } = await loadModule();
  assert.throws(() => assertNotCompacting(true), /压缩/);
  assert.doesNotThrow(() => assertNotCompacting(false));
});
