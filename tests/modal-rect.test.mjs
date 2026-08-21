import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  const mod = await import(
    new URL("../components/app-shell/useModalRect.ts", import.meta.url).href
  );
  return mod.default ?? mod;
}

// clampModalRect 读 window.innerWidth/innerHeight，node 环境无 window：
// 打一个最小 globalThis.window 桩（loadModule 之后赋值，供调用时读取）。
function stubWindow(vw, vh) {
  globalThis.window = { innerWidth: vw, innerHeight: vh };
}

test("clampModalRect: 过小尺寸被夹到最小宽高", async () => {
  const { clampModalRect } = await loadModule();
  stubWindow(1920, 1080);
  const r = clampModalRect({ x: 100, y: 100, width: 10, height: 10 });
  assert.equal(r.width, 360);
  assert.equal(r.height, 260);
});

test("clampModalRect: 超大尺寸被夹到视口内（留 EDGE 边距）", async () => {
  const { clampModalRect } = await loadModule();
  stubWindow(800, 600);
  const r = clampModalRect({ x: 0, y: 0, width: 5000, height: 5000 });
  assert.equal(r.width, 800 - 24);
  assert.equal(r.height, 600 - 24);
});

test("clampModalRect: 跑出视口的位置被拉回（右侧/下侧至少留 EDGE）", async () => {
  const { clampModalRect } = await loadModule();
  stubWindow(1000, 800);
  const r = clampModalRect({ x: 9000, y: 7000, width: 400, height: 300 });
  assert.equal(r.x, 1000 - 400 - 12);
  assert.equal(r.y, 800 - 300 - 12);
  const left = clampModalRect({ x: -50, y: -50, width: 400, height: 300 });
  assert.equal(left.x, 12);
  assert.equal(left.y, 12);
});

test("clampModalRect: 视口内的矩形原样保留", async () => {
  const { clampModalRect } = await loadModule();
  stubWindow(1920, 1080);
  const r = clampModalRect({ x: 300, y: 200, width: 800, height: 500 });
  assert.deepEqual(r, { x: 300, y: 200, width: 800, height: 500 });
});
