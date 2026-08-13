import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  // jiti 把 .ts 编译为 CJS 后，ESM import() 的命名导出会折叠到 default 对象上。
  // 兼容 default 与非 default 两种形态，避免依赖宿主 jiti/Node 的 interop 细节。
  const mod = await import(new URL("../lib/models-config-test-connection.ts", import.meta.url).href);
  return mod.default ?? mod;
}

test("pickTestModelId prefers the first configured model id", async () => {
  const { pickTestModelId } = await loadModule();
  const modelId = pickTestModelId({
    models: [
      { id: "anthropic/claude-opus-4.7" },
      { id: "backup-model" },
    ],
  });

  assert.equal(modelId, "anthropic/claude-opus-4.7");
});

test("pickTestModelId falls back to provider-level modelId when models array is empty", async () => {
  const { pickTestModelId } = await loadModule();
  const modelId = pickTestModelId({
    modelId: "anthropic/claude-opus-4.7",
    models: [],
  });

  assert.equal(modelId, "anthropic/claude-opus-4.7");
});
