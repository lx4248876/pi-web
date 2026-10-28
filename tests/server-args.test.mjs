// 启动参数回归测试（对应 docs/audit-report-2026-10.md 的 S1）
//
// 项目 ADR 承诺「仅监听 127.0.0.1」，但 bin/pi-web.js 只在用户显式传 -H 时才把
// hostname 交给 next start，默认情况下 next start 会监听 0.0.0.0 → 局域网可达，
// 而所有 /api/* 都没有鉴权（含写文件、执行 git 命令）。
//
// 这里锁定「默认必须显式绑定 127.0.0.1」，并保证放开监听只能靠显式开关。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("默认绑定回环地址，并把 -H 显式传给 next start", () => {
  const { resolveServerArgs } = require("../bin/server-args.js");
  const got = resolveServerArgs({ cliPort: undefined, cliHost: undefined, env: {} });
  assert.equal(got.hostname, "127.0.0.1");
  assert.deepEqual(got.nextArgs, ["start", "-p", "30141", "-H", "127.0.0.1"]);
});

test("环境里的 HOSTNAME 不会顺带把监听面放开", () => {
  const { resolveServerArgs } = require("../bin/server-args.js");
  const got = resolveServerArgs({ cliPort: undefined, cliHost: undefined, env: { HOSTNAME: "my-laptop", PORT: "4000" } });
  assert.equal(got.hostname, "127.0.0.1");
  assert.deepEqual(got.nextArgs, ["start", "-p", "4000", "-H", "127.0.0.1"]);
});

test("放开监听需要显式 --hostname 或 PI_WEB_HOST", () => {
  const { resolveServerArgs } = require("../bin/server-args.js");
  const cli = resolveServerArgs({ cliPort: "5000", cliHost: "0.0.0.0", env: {} });
  assert.equal(cli.hostname, "0.0.0.0");
  assert.deepEqual(cli.nextArgs, ["start", "-p", "5000", "-H", "0.0.0.0"]);

  const env = resolveServerArgs({ cliPort: undefined, cliHost: undefined, env: { PI_WEB_HOST: "192.168.1.5" } });
  assert.equal(env.hostname, "192.168.1.5");
});

test("CLI 参数优先于环境变量", () => {
  const { resolveServerArgs } = require("../bin/server-args.js");
  const got = resolveServerArgs({ cliPort: "6000", cliHost: "127.0.0.1", env: { PI_WEB_HOST: "0.0.0.0" } });
  assert.equal(got.hostname, "127.0.0.1");
  assert.equal(got.port, "6000");
});
