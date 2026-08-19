import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 用相对路径导入：jiti 不解析 tsconfig 的 @/ 别名
import { startRpcSession } from "../lib/rpc-manager";

function setup(tag: string) {
	const cwd = mkdtempSync(join(tmpdir(), `pi-web-${tag}-`));
	const agentDir = mkdtempSync(join(tmpdir(), `pi-web-agent-${tag}-`));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(agentDir, "sessions"), { recursive: true });
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));
	return { cwd, agentDir };
}

// 复现方向：会话 A 挂起一个未回答的 question，随后会话 B 独立触发 question，
// 验证 B 的 extension_ui_request 是否能送达 B 自己的监听器（即 A 的挂起是否
// 会吞掉/挡住 B 的弹窗）。
test("session B question still fires while session A holds an unanswered question", async () => {
	const a = setup("a");
	const b = setup("b");
	let sa: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	let sb: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	try {
		const startedA = await startRpcSession("sess-a", "", a.cwd, []);
		const startedB = await startRpcSession("sess-b", "", b.cwd, []);
		sa = startedA.session;
		sb = startedB.session;

		// A 挂起一个待回答的 question（不回复）
		const aHold = sa.createExtensionUIContext().select("A 标题", ["选项1"]);

		// 给 A 的事件足够时间发出、且 A 处于挂起态
		await new Promise((r) => setTimeout(r, 80));

		// B 独立触发 question，B 自己订阅事件
		const eventsB: Array<{ type: string; method?: string; id?: string }> = [];
		const unsubB = sb.onEvent((event) => {
			eventsB.push(event as never);
			if (
				event.type === "extension_ui_request" &&
				(event as never as { method: string }).method === "select" &&
				event.id
			) {
				sb!.send({
					type: "extension_ui_response",
					id: event.id,
					value: "B 答案",
				});
			}
		});

		const bResult = await Promise.race([
			sb.createExtensionUIContext().select("B 标题", ["选项1", "选项2"]),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("B question never resolved")), 3000),
			),
		]);
		unsubB();

		assert.equal(bResult, "B 答案");
		assert.ok(
			eventsB.some(
				(e) =>
					e.type === "extension_ui_request" &&
					e.method === "select" &&
					"title" in e && (e as never as { title: string }).title === "B 标题",
			),
			"B 的 select 事件应送达 B 的监听器",
		);

		// A 的挂起弹窗仍应在 A 侧 pending（未被误处理）
		assert.equal(eventsB.filter((e) => e.type === "extension_ui_request").length, 1);

		void aHold; // A 的挂起 promise 由下方 destroy 清理，不在此 await
	} finally {
		sa?.destroy();
		sb?.destroy();
		rmSync(a.cwd, { recursive: true, force: true });
		rmSync(b.cwd, { recursive: true, force: true });
	}
});