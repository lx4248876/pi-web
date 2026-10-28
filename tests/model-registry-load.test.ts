// pi 1.4.0 升级回归：models.json 里配了 key 的 provider 必须能被「同步读到」。
//
// 这条守卫的来历：升级后第一次真机运行时 `GET /api/models` 返回空列表，一度怀疑是
// 1.4.0 把 ModelRegistry 改成「必须 await refresh() 才能同步读」导致的。实测结论：
// **不是**——本机 models.json 里 10 个 provider 的 apiKey 全是 `$ENV` 引用而环境变量
// 未设置（`getProviderAuthStatus().configured === false`），所以可用模型为 0 才是正确
// 行为。给一个带字面量 key 的自定义 provider 后，`getAvailable()` 立刻就有数据。
//
// 因此这里锁定真实契约：pi 1.4.0 下 `ModelRuntime.create()` + `ModelRegistry` 直接
// `getAvailable()` 就能读到 models.json 的内容；将来哪个版本破坏它，这条测试会红。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

function makeAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-agent-"));
  writeFileSync(join(dir, "auth.json"), "{}", "utf8");
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify(
      {
        providers: {
          "local-test": {
            name: "Local Test",
            baseUrl: "http://127.0.0.1:9/v1",
            api: "openai-completions",
            apiKey: "sk-test-not-used",
            models: [
              {
                id: "test-model-1",
                name: "Test Model 1",
                contextWindow: 8000,
                maxTokens: 512,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return dir;
}

test("models.json 里带字面量 key 的 provider 立刻出现在 getAvailable() 里", async () => {
  const agentDir = makeAgentDir();
  try {
    const runtime = await ModelRuntime.create({
      modelsPath: join(agentDir, "models.json"),
      authPath: join(agentDir, "auth.json"),
      allowModelNetwork: false,
    });
    const registry = new ModelRegistry(runtime);

    const available = registry.getAvailable();
    assert.equal(available.length, 1);
    assert.equal(available[0].provider, "local-test");
    assert.equal(available[0].id, "test-model-1");
    assert.equal(registry.find("local-test", "test-model-1")?.name, "Test Model 1");
    assert.equal(registry.getProviderAuthStatus("local-test").configured, true);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("$ENV 引用的 key 未设置时，模型不可用（不是加载失败）", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-agent-env-"));
  try {
    writeFileSync(join(agentDir, "auth.json"), "{}", "utf8");
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "env-test": {
            baseUrl: "http://127.0.0.1:9/v1",
            api: "openai-completions",
            apiKey: "$PI_WEB_TEST_UNSET_KEY_DO_NOT_SET",
            models: [
              {
                id: "m1",
                name: "M1",
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
      "utf8",
    );
    const runtime = await ModelRuntime.create({
      modelsPath: join(agentDir, "models.json"),
      authPath: join(agentDir, "auth.json"),
      allowModelNetwork: false,
    });
    const registry = new ModelRegistry(runtime);
    assert.equal(registry.getProviderAuthStatus("env-test").configured, false);
    assert.equal(registry.getAvailable().length, 0);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
