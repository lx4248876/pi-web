// SSE 写帧器（对应 docs/audit-report-2026-10.md 的 S7）
//
// ReadableStream 的 controller 一旦被 abort/close，后续 enqueue 会抛 TypeError。
// 之前这个异常发生在 wrapper.emit() 的同步 for 循环里，会顺着 pi SDK 的 subscribe
// 回调冒泡，导致同一次 emit 的后续监听器被跳过（丢帧）甚至打断本轮生成。
import test from "node:test";
import assert from "node:assert/strict";
import { SseWriter, formatSseData, formatSseHeartbeat } from "../lib/sse-writer";

function sink() {
  const frames: string[] = [];
  let closed = false;
  return {
    frames,
    get closed() {
      return closed;
    },
    controller: {
      enqueue(chunk: Uint8Array) {
        if (closed) throw new TypeError("Invalid state: Controller is already closed");
        frames.push(new TextDecoder().decode(chunk));
      },
      close() {
        closed = true;
      },
    },
  };
}

test("formatSseData / formatSseHeartbeat 生成合法帧", () => {
  assert.equal(formatSseData({ a: 1 }), 'data: {"a":1}\n\n');
  assert.equal(formatSseHeartbeat(), ":\n\n");
});

test("正常写入与关闭", () => {
  const s = sink();
  const w = new SseWriter(s.controller, { heartbeatMs: 0 });
  assert.equal(w.send({ type: "connected" }), true);
  assert.equal(w.sendHeartbeat(), true);
  assert.equal(s.frames.length, 2);
  w.close();
  assert.equal(s.closed, true);
  assert.equal(w.isClosed(), true);
  // 关闭后再写不得抛错，只是返回 false
  assert.equal(w.send({ type: "late" }), false);
});

test("controller 已关闭时不抛错并把 writer 标记为关闭", () => {
  const s = sink();
  const w = new SseWriter(s.controller, { heartbeatMs: 0 });
  s.controller.close(); // 模拟客户端断开 / 已被 abort
  assert.doesNotThrow(() => w.send({ type: "boom" }));
  assert.equal(w.send({ type: "boom2" }), false);
  assert.equal(w.isClosed(), true);
});
