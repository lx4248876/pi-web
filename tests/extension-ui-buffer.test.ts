import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRpcSession } from "@/lib/rpc-manager";

test("extension_ui_request dialog is buffered and replayed when listener connects late", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-test-"));
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mkdirSync(join(agentDir, "sessions"), { recursive: true });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));

  let session: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
  try {
    const started = await startRpcSession("test-session", "", cwd, []);
    session = started.session;

    const ui = session.createExtensionUIContext();
    const confirmPromise = ui.confirm("Test confirm", "Please click Yes");

    // 故意先不订阅事件，模拟“后端已发、前端未连”的窗口期
    await new Promise((r) => setTimeout(r, 50));

    const events: Array<{ type: string; method?: string; id?: string }> = [];
    const unsubscribe = session.onEvent((event) => {
      events.push(event as never);
      if (event.type === "extension_ui_request" && (event as never as { method: string }).method === "confirm" && event.id) {
        session!.send({ type: "extension_ui_response", id: event.id, confirmed: true });
      }
    });

    const result = await Promise.race([
      confirmPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);

    unsubscribe();
    assert.strictEqual(result, true);
    assert.ok(events.some((e) => e.type === "extension_ui_request" && e.method === "confirm"));
  } finally {
    session?.destroy();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});
