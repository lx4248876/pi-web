import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDshCredentialsIntoEnv,
  parseCredentialRefs,
  resolveDshHome,
} from "../lib/dsh-credentials";

const SAMPLE = `version: 1
refs:
  DGRID_9ADD_API_KEY: sk-aaaa
  OPENROUTER_API_KEY: "sk-or-bbbb"
  NICCOM_API_KEY: 'sk-cccc'
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: should-not-be-read
`;

function tmpDsh(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-dsh-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, "utf8");
  return dir;
}

test("只解析 refs 段，records 段里的 secret 不会被当成变量", () => {
  const refs = parseCredentialRefs(SAMPLE);
  assert.deepEqual(Object.keys(refs).sort(), [
    "DGRID_9ADD_API_KEY",
    "NICCOM_API_KEY",
    "OPENROUTER_API_KEY",
  ]);
  assert.equal(refs.DGRID_9ADD_API_KEY, "sk-aaaa");
  assert.equal(refs.OPENROUTER_API_KEY, "sk-or-bbbb");
  assert.equal(refs.NICCOM_API_KEY, "sk-cccc");
  assert.equal(refs.secret, undefined);
});

test("把 refs 注入 env，且不覆盖已存在的变量", () => {
  const dir = tmpDsh({ ".credentials.yaml": SAMPLE });
  try {
    const env: Record<string, string | undefined> = { OPENROUTER_API_KEY: "user-set" };
    const res = loadDshCredentialsIntoEnv(env, dir);

    assert.equal(res.loaded, true);
    assert.deepEqual(res.injected.sort(), ["DGRID_9ADD_API_KEY", "NICCOM_API_KEY"]);
    assert.deepEqual(res.skipped, ["OPENROUTER_API_KEY"]);
    assert.equal(env.DGRID_9ADD_API_KEY, "sk-aaaa");
    // 用户显式设置的值优先
    assert.equal(env.OPENROUTER_API_KEY, "user-set");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("结果里只有变量名，绝不含密文", () => {
  const dir = tmpDsh({ ".credentials.yaml": SAMPLE });
  try {
    const env: Record<string, string | undefined> = {};
    const res = loadDshCredentialsIntoEnv(env, dir);
    const serialized = JSON.stringify(res);
    assert.equal(serialized.includes("sk-aaaa"), false);
    assert.equal(serialized.includes("sk-or-bbbb"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("文件缺失时安静失败（不抛错，不影响启动）", () => {
  const dir = tmpDsh({});
  try {
    const env: Record<string, string | undefined> = {};
    const res = loadDshCredentialsIntoEnv(env, dir);
    assert.equal(res.loaded, false);
    assert.deepEqual(res.injected, []);
    assert.ok(res.error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveDshHome 优先级：PI_WEB_DSH_HOME > DSH_HOME > ~/.dsh", () => {
  assert.equal(resolveDshHome({ PI_WEB_DSH_HOME: "/a", DSH_HOME: "/b" }), "/a");
  assert.equal(resolveDshHome({ DSH_HOME: "/b" }), "/b");
  assert.match(resolveDshHome({}), /\.dsh$/);
});