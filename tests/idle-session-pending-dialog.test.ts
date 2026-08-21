import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRpcSession, __setIdleDestroyMs } from "../lib/rpc-manager";

function setup(tag: string) {
	const cwd = mkdtempSync(join(tmpdir(), `pi-web-idle-${tag}-`));
	const agentDir = mkdtempSync(join(tmpdir(), `pi-web-idle-agent-${tag}-`));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(agentDir, "sessions"), { recursive: true });
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));
	return { cwd, agentDir };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 根因：agent 发出 question 工具调用的 inner 事件已同步触发 resetIdleTimer 上膛（此刻
// pending 尚未填）；弹窗后若无新事件/send，已上膛的 10 分钟 idle 到点就 destroy，把
// 未答 dialog resolve(cancelled:true) 落成 toolResult「User cancelled.」，文件里的悬空
// question 被改写，恢复路径失效、弹窗永久消失。修复：timer 回调内判 pending，有未答就
// 重排不销毁。此处 __setIdleDestroyMs 缩短阈值，让 10 分钟在几百毫秒内到点复现。
test("an unanswered question survives the idle timer firing (session not idle-collected)", async () => {
	__setIdleDestroyMs(200);
	const { cwd, agentDir } = setup("pending");
	let s: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	const unsubs: Array<() => void> = [];
	try {
		s = (await startRpcSession("idle-pending", "", cwd, [])).session;
		unsubs.push(s.onEvent(() => {}));

		// 弹一个未答 question，不提答它。
		const pending = s.createExtensionUIContext().select("问题", ["x"]);
		void pending;
		await wait(60);
		assert.equal(s.pendingDialogs.length, 1, "弹窗必须挂起为待答");

		// 等超过缩短后的 idle 阈值——已上膛 timer 到点。
		await wait(400);
		assert.equal(
			s.isAlive(),
			true,
			"有未答 dialog 时 idle 到点绝不能 destroy 会话",
		);
		assert.equal(s.pendingDialogs.length, 1, "未答问题必须仍在，不能被改写成已取消");
	} finally {
		unsubs.forEach((u) => u());
		s?.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

// 反向：没有任何未答 dialog 且无人活动时，idle 仍要正常回收（idle 定时器的原需求不被破坏）。
test("an idle session with no pending dialog is still collected", async () => {
	__setIdleDestroyMs(150);
	const { cwd, agentDir } = setup("reaped");
	let s: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
	try {
		s = (await startRpcSession("idle-reap", "", cwd, [])).session;
		assert.equal(s.pendingDialogs.length, 0);
		await wait(400);
		assert.equal(s.isAlive(), false, "无未答 dialog 且空闲时会话应被 idse 回收");
	} finally {
		if (s?.isAlive()) s.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});