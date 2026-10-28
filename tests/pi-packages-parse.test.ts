import test from "node:test";
import assert from "node:assert/strict";
import { parseInstalledPackages } from "../lib/pi-packages";

test("空列表哨兵行不会被当成插件", () => {
  assert.deepEqual(parseInstalledPackages("No packages installed.\n"), []);
  assert.deepEqual(parseInstalledPackages("no packages installed\n"), []);
});

test("解析 npm: 源与 scoped 包名", () => {
  assert.deepEqual(parseInstalledPackages("npm:@hypabolic/pi-hypa\n"), [
    { source: "npm:@hypabolic/pi-hypa", name: "@hypabolic/pi-hypa" },
  ]);
});

test("跳过 section 标题和缩进的本地路径行", () => {
  const out = parseInstalledPackages(
    ["User packages:", "npm:pi-foo", "  C:\\code\\foo\\extension.ts", "Project packages:", "git:github.com/a/b"].join("\n"),
  );
  assert.deepEqual(out, [
    { source: "npm:pi-foo", name: "pi-foo" },
    { source: "git:github.com/a/b", name: "git:github.com/a/b" },
  ]);
});

test("空输入返回空数组", () => {
  assert.deepEqual(parseInstalledPackages(""), []);
});