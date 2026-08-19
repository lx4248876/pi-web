import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 用相对路径导入：jiti 不解析 tsconfig 的 @/ 别名
import { startRpcSession } from "../lib/rpc-manager";

function setup(tag: string) {
	const cwd = mkdtempSync(join(tmpdir(), `pi-web-blk-${tag}-`));
	const agentDir = mkdtempSync(join(tmpdir(), `pi-web-agent-${tag}-`));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(agentDir, "sessions"), { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({ providers: {} }),
	);
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));
	return { cwd, agentDir };
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
	Promise.race([
		p,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`${what} timed out (${ms}ms)`)), ms),
		),
	]);

// 决定性诊断：会话 A 挂起一条「没监听器、没人答」的 question，
// 会话 B 接着是否还能独立地把自己的 question 答完。
// 若 B 超时 → 存在跨会话死锁（一个未答 question 冻结所有会话），即用户报的「卡死」。
test("session B still answers while session A holds an unanswered question", async () => {
	const { cwd: cwdA, agentDir: dirA } = setup("a");
	const { cwd: cwdB, agentDir: dirB } = setup("b");
	let sa: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	let sb: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	try {
		sa = (await startRpcSession("sess-a", "", cwdA, [])).session;
		sb = (await startRpcSession("sess-b", "", cwdB, [])).session;

		// A 挂起一个未答 question（没监听器 = 没弹窗被点）
		const holdA = sa.createExtensionUIContext().select("A 挂起", ["选项"]);
		void holdA;

		// 给 A 一点时间进入挂起态
		await new Promise((r) => setTimeout(r, 80));

		// B 自带监听器并立即作答
		const unsubB = sb.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as never as { method: string }).method === "select" &&
				(event as never as { id?: string }).id
			) {
				sb!.send({
					type: "extension_ui_response",
					id: (event as never as { id: string }).id,
					value: "B 答了",
				});
			}
		});
		try {
			const bResult = await withTimeout(
				sb.createExtensionUIContext().select("B 正常问", ["x", "y"]),
				3000,
				"会话 B 的 question",
			);
			assert.equal(bResult, "B 答了", "B 应能正常作答，不受 A 挂起影响");
		} finally {
			unsubB();
		}
	} finally {
		sa?.destroy();
		sb?.destroy();
		rmSync(cwdA, { recursive: true, force: true });
		rmSync(dirA, { recursive: true, force: true });
		rmSync(cwdB, { recursive: true, force: true });
		rmSync(dirB, { recursive: true, force: true });
	}
});