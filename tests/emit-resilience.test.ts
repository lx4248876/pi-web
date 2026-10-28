// AgentSessionWrapper.emit 的健壮性（对应 docs/audit-report-2026-10.md 的 S7）
//
// emit 在 pi SDK 的事件回调里被同步调用。任何一个 SSE 监听器抛错（例如 controller
// 已关闭时的 enqueue）都会沿着 SDK 的 subscribe 回调冒泡，跳过同一次 emit 的其余
// 监听器，并让每条重连泄漏一个监听器。这里锁定：抛错的监听器被隔离并自动摘除。
import test from "node:test";
import assert from "node:assert/strict";
import { AgentSessionWrapper } from "../lib/rpc-manager";

function makeWrapper(): AgentSessionWrapper {
  const inner = {
    sessionId: "s1",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
  };
  return new AgentSessionWrapper(inner as never);
}

test("抛错的监听器不打断其余监听器，并被自动摘除", () => {
  const wrapper = makeWrapper();
  const seen: string[] = [];
  let badCalls = 0;

  const unsubscribeBad = wrapper.onEvent(() => {
    badCalls += 1;
    throw new Error("controller already closed");
  });
  wrapper.onEvent((event) => seen.push(String((event as { type: string }).type)));

  const originalError = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => logged.push(args[0]);
  try {
    assert.doesNotThrow(() => wrapper.emit({ type: "message_update" }));
    assert.doesNotThrow(() => wrapper.emit({ type: "message_end" }));
  } finally {
    console.error = originalError;
  }

  // 好监听器两次都收到
  assert.deepEqual(seen, ["message_update", "message_end"]);
  // 坏监听器只在第一次被调用（随后自动摘除），并留下了日志
  assert.equal(badCalls, 1);
  assert.equal(logged.length >= 1, true);

  // 手动退订仍然可用
  assert.doesNotThrow(() => unsubscribeBad());
  wrapper.destroy();
});
