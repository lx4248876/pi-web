import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChildSessionTailer, sessionEntriesToMessages } from "../lib/subagent-live";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-web-live-"));
}

const HDR = JSON.stringify({ type: "session", version: 3, id: "child1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/w" });
function msgLine(idx: number, role: string, text: string): string {
  return JSON.stringify({ type: "message", id: `m${idx}`, timestamp: `2026-01-01T00:00:0${idx}.000Z`, parentId: null, message: { role, content: [{ type: "text", text }] } });
}
function toolMsgLine(idx: number): string {
  return JSON.stringify({ type: "message", id: `m${idx}`, timestamp: `2026-01-01T00:00:0${idx}.000Z`, parentId: null, message: { role: "assistant", content: [{ type: "toolCall", id: "tc1", tool: "bash", args: "ls" }] } });
}

test("sessionEntriesToMessages extracts only message entries in order", () => {
  const dir = tmpDir();
  try {
    const file = join(dir, "c.jsonl");
    writeFileSync(file, [HDR, msgLine(1, "user", "task"), msgLine(2, "assistant", "reply")].join("\n") + "\n", "utf8");
    const msgs = sessionEntriesToMessages(file);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0]!.role, "user");
    assert.equal(msgs[1]!.role, "assistant");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ChildSessionTailer seeds seenCount at construction, delivering only post-connect appends", () => {
  const dir = tmpDir();
  try {
    const file = join(dir, "c.jsonl");
    writeFileSync(file, [HDR, msgLine(1, "user", "task")].join("\n") + "\n", "utf8");
    const tailer = new ChildSessionTailer(file);
    // 历史已由 loadSession 加载，首次 poll 不应重复整段历史。
    const first = tailer.poll();
    assert.equal(first.messages.length, 0, "pre-existing history must not be re-delivered");

    // Appended while still working (pending toolCall, no result yet) => still running
    appendFileSync(file, toolMsgLine(2) + "\n", "utf8");
    const second = tailer.poll();
    assert.equal(second.messages.length, 1, "only new message, not a re-delivery of history");
    assert.equal((second.messages[0]!.content as { type: string }[])[0].type, "toolCall");
    assert.equal(second.running, true, "pending toolCall => still running");

    // No new bytes => empty
    const third = tailer.poll();
    assert.equal(third.messages.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ChildSessionTailer reports running=false when file tail is terminal", () => {
  const dir = tmpDir();
  try {
    const file = join(dir, "c.jsonl");
    writeFileSync(file, [HDR, msgLine(1, "user", "task"), msgLine(2, "assistant", "final")].join("\n") + "\n", "utf8");
    const tailer = new ChildSessionTailer(file);
    const sample = tailer.poll();
    assert.equal(sample.running, false, "completed tail => not running");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("subagent-live module must not import rpc-manager (guarantees no agent start)", async () => {
  // Static guard: the live module is a pure read-only tailer over session files.
  const src = await import("node:fs/promises").then((fsp) => fsp.readFile(join("lib", "subagent-live.ts"), "utf8"));
  const hasRpcImport = /\bstartRpcSession\b|\bgetRpcSession\b/.test(src) || /\brpc-manager\b/.test(src);
  assert.equal(hasRpcImport, false, "subagent-live must never reference rpc-manager / start agent");
});