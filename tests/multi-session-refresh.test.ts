import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRpcSession } from "../lib/rpc-manager";

function setup(tag: string) {
	const cwd = mkdtempSync(join(tmpdir(), `pi-web-refresh-${tag}-`));
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 两个会话各有未答 question → 刷新(断连后重连)：两条都被重放，一条都不丢。
test("both sessions' unanswered questions survive a disconnect/reconnect (refresh)", async () => {
	const { cwd: cwdA, agentDir: dirA } = setup("a");
	const { cwd: cwdB, agentDir: dirB } = setup("b");
	let sa: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	let sb: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	try {
		sa = (await startRpcSession("sess-a", "", cwdA, [])).session;
		sb = (await startRpcSession("sess-b", "", cwdB, [])).session;

		const unsubA = sa.onEvent(() => {});
		const unsubB = sb.onEvent(() => {});
		const qA = sa.createExtensionUIContext().select("A 问题", ["x"]);
		const qB = sb.createExtensionUIContext().select("B 问题", ["x"]);
		void qA;
		void qB;
		await wait(80);

		// 模拟刷新：旧连接全断（最后一个监听器拆掉时服务端会把未答问题重新入缓冲）。
		unsubA();
		unsubB();
		await wait(30);

		// 模拟刷新后重连：两个会话各新开一个监听器，收集重放的问题。
		let replayA: string | null = null;
		let replayB: string | null = null;
		const unsubA2 = sa.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as unknown as { method: string }).method === "select"
			)
				replayA = (event as unknown as { title: string }).title;
		});
		const unsubB2 = sb.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as unknown as { method: string }).method === "select"
			)
				replayB = (event as unknown as { title: string }).title;
		});
		await wait(80);

		assert.equal(replayA, "A 问题", "A 的未答问题重连后必须还在");
		assert.equal(replayB, "B 问题", "B 的未答问题重连后必须还在");

		unsubA2();
		unsubB2();
	} finally {
		sa?.destroy();
		sb?.destroy();
		rmSync(cwdA, { recursive: true, force: true });
		rmSync(dirA, { recursive: true, force: true });
		rmSync(cwdB, { recursive: true, force: true });
		rmSync(dirB, { recursive: true, force: true });
	}
});

// 刷新后先还原到会话 A，用户稍后才切到会话 B——此时 B 的未答问题也必须送到。
test("late reconnect (switch to the other session after refresh) still delivers its pending question", async () => {
	const { cwd: cwdA, agentDir: dirA } = setup("late-a");
	const { cwd: cwdB, agentDir: dirB } = setup("late-b");
	let sa: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	let sb: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	try {
		sa = (await startRpcSession("sess-a", "", cwdA, [])).session;
		sb = (await startRpcSession("sess-b", "", cwdB, [])).session;

		// 两个会话各挂一条未答问题，且都有过监听器（刷新前用户在其中的一个会话）。
		const unsubA0 = sa.onEvent(() => {});
		const unsubB0 = sb.onEvent(() => {});
		const qA = sa.createExtensionUIContext().select("A 问题", ["x"]);
		const qB = sb.createExtensionUIContext().select("B 问题", ["x"]);
		void qA;
		void qB;
		await wait(80);
		unsubA0();
		unsubB0(); // 刷新：旧连接全断。
		await wait(30);

		// 刷新后先还原到会话 A：只重连 A。
		let replayA: string | null = null;
		const unsubA = sa.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as unknown as { method: string }).method === "select"
			)
				replayA = (event as unknown as { title: string }).title;
		});
		await wait(80);
		assert.equal(replayA, "A 问题");

		// 用户稍后切到会话 B：此刻才重连 B，必须把 B 的未答问题也送来。
		let replayB: string | null = null;
		const unsubB = sb.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as unknown as { method: string }).method === "select"
			)
				replayB = (event as unknown as { title: string }).title;
		});
		await wait(80);
		assert.equal(replayB, "B 问题", "切换到 B 后必须拿到 B 的未答问题");

		unsubA();
		unsubB();
	} finally {
		sa?.destroy();
		sb?.destroy();
		rmSync(cwdA, { recursive: true, force: true });
		rmSync(dirA, { recursive: true, force: true });
		rmSync(cwdB, { recursive: true, force: true });
		rmSync(dirB, { recursive: true, force: true });
	}
});

// 复现真实根因：问题在「已有监听器」时 live 投递（因此不进缓冲），随后第二个监听器
// 挂上（模拟刷新/切换时旧连接没干净摘掉、新连接已经建好）。新监听器必须仍能拿到这个
// 未答问题——否则徽标在但点进去不弹。旧实现只从 eventBuffer 回放，会漏；新实现直接从
// pendingExtensionRequests（未答权威集合）回放，必达。
test("a live-delivered pending question is delivered to a later-attached listener", async () => {
	const { cwd, agentDir } = setup("live");
	let s: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	try {
		s = (await startRpcSession("sess-live", "", cwd, [])).session;

		// 先有一个监听器，此时触发问题 → live 投递（旧代码不会把它写进 eventBuffer）。
		let firstGot: string | null = null;
		const unsub1 = s.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as unknown as { method: string }).method === "select"
			)
				firstGot = (event as unknown as { title: string }).title;
		});
		const q = s.createExtensionUIContext().select("live 问题", ["x"]);
		void q;
		await wait(60);
		assert.equal(firstGot, "live 问题", "第一个监听器应 live 收到");

		// 旧连接没摘（unsub1 不调用），第二个监听器直接挂上——模拟刷新/切换的竞态。
		let secondGot: string | null = null;
		const unsub2 = s.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as unknown as { method: string }).method === "select"
			)
				secondGot = (event as unknown as { title: string }).title;
		});
		await wait(60);
		assert.equal(secondGot, "live 问题", "第二个监听器必须也能拿到未答问题");

		unsub1();
		unsub2();
	} finally {
		s?.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});