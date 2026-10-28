// pi 1.4.0 升级回归：内置工具与「扩展工具自动启用」的边界。
//
// 背景：composeActiveTools() 把「不在 BUILTIN_TOOL_NAMES 里的工具」一律当成扩展
// 工具自动启用。1.4.0 新增了原生 `powershell` 工具，若不同步进内置名单，它会在
// 每个非 Off 预设里被悄悄打开（Windows 下等于多了一条可执行命令的通道）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_TOOL_NAMES,
  CODING_TOOL_NAMES,
  composeActiveTools,
  extensionToolNamesOf,
} from "../lib/tool-composition";

test("powershell 属于内置编码工具，不被当成扩展工具自动启用", () => {
  assert.equal(BUILTIN_TOOL_NAMES.has("powershell"), true);
  assert.deepEqual(extensionToolNamesOf([{ name: "powershell" }, { name: "subagent" }]), ["subagent"]);
});

test("非 Off 预设 = 选中内置 + question + 扩展工具", () => {
  const composed = composeActiveTools(["read", "bash"], [{ name: "read" }, { name: "powershell" }, { name: "subagent" }]);
  assert.deepEqual(composed.sort(), ["bash", "question", "read", "subagent"]);
});

test("Off 预设（[]）连扩展工具一起关掉", () => {
  assert.deepEqual(composeActiveTools([], [{ name: "subagent" }]), []);
});

test("内置名单包含 pi 的七件套 + powershell", () => {
  for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"]) {
    assert.ok((CODING_TOOL_NAMES as readonly string[]).includes(name), name);
  }
});
