import test from "node:test";
import assert from "node:assert/strict";
import { applyExtensionStatus, applyExtensionWidget } from "../lib/extension-panel-state";

test("setStatus: 写入后能读到；同值重复写入返回同一对象（避免无谓重渲染）", () => {
  const a = applyExtensionStatus({}, "build", "compiling");
  assert.deepEqual(a, { build: "compiling" });
  const b = applyExtensionStatus(a, "build", "compiling");
  assert.equal(b, a);
});

test("setStatus: 空字符串/空白表示扩展撤掉该 key，而不是留一个空标签", () => {
  const a = { build: "compiling", tests: "running" };
  assert.deepEqual(applyExtensionStatus(a, "build", ""), { tests: "running" });
  assert.deepEqual(applyExtensionStatus(a, "tests", "   "), { build: "compiling" });
  assert.deepEqual(applyExtensionStatus(a, "missing", ""), a);
});

test("setStatus: 值首尾空白被裁掉", () => {
  assert.deepEqual(applyExtensionStatus({}, "k", "  x  "), { k: "x" });
});

test("setWidget: 空行会被过滤；全空等价于撤掉", () => {
  assert.deepEqual(applyExtensionWidget({}, "w", ["a", "", "  ", "b"]), { w: ["a", "b"] });
  assert.deepEqual(applyExtensionWidget({ w: ["a"] }, "w", []), {});
  assert.deepEqual(applyExtensionWidget({ w: ["a"] }, "w", ["", " "]), {});
  assert.deepEqual(applyExtensionWidget({ other: ["x"] }, "w", []), { other: ["x"] });
});

test("setWidget: 内容未变时返回同一对象", () => {
  const a = applyExtensionWidget({}, "w", ["a", "b"]);
  assert.equal(applyExtensionWidget(a, "w", ["a", "b"]), a);
  // 只差空行也算未变
  assert.equal(applyExtensionWidget(a, "w", ["a", "", "b"]), a);
});

test("两个通道互不影响", () => {
  const s = applyExtensionStatus({}, "shared", "text");
  const w = applyExtensionWidget({}, "shared", ["line"]);
  assert.deepEqual(s, { shared: "text" });
  assert.deepEqual(w, { shared: ["line"] });
});