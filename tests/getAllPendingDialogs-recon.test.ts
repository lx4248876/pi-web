import test from "node:test";
import assert from "node:assert/strict";
import {
	getAllPendingDialogs,
	unionPendingDialogs,
	type FilePendingScanner,
} from "../lib/rpc-manager";
import type { AgentEvent } from "../lib/rpc-manager";

// 目标：修复「待答徽标只数已打开 wrapper（内存）」的问题——getAllPendingDialogs
// 应把文件派生的悬空 question 会话也并入结果，使进程重启 / 10 分钟 idle destroy 后
// 徽标仍亮（文件有就亮）。
//
// 关键：全程不写真实 pi 会话 .jsonl 到 agent dir；用假 scanner / 纯函数（union
// 缝）测逻辑。默认真 scanner 的 IO 路径是集成路径，另做手动验证（见交付说明）。

/** 内存/fake 里的 request 按徽标契约只用 sessionId——形状只要不崩即可。 */
function req(request: {
	method: string;
	title: string;
	question: string;
}): AgentEvent {
	return { type: "extension_ui_request", ...request };
}

const fileReq = req({ method: "input", title: "x", question: "?" });

/** 返回一个固定结果的假 scanner。 */
function fakeScanner(
	result: Array<{ sessionId: string; request: AgentEvent }>,
): FilePendingScanner {
	return async ({ excludeIds }) =>
		result.filter((r) => !excludeIds.has(r.sessionId));
}

test("[Red] file-derived pending session is included even when not in memory", async () => {
	// 回归场景：本进程没开这个会话，但文件里有悬空 question → 徽标仍应返回它。
	const file = [{ sessionId: "file-sid", request: fileReq }];
	const result = await getAllPendingDialogs(fakeScanner(file));
	assert.ok(
		result.some((d) => d.sessionId === "file-sid"),
		"结果应包含文件派生的 sessionId (file-sid)",
	);
});

test("unionPendingDialogs dedupes memory+file same id -> once, memory wins", () => {
	const memory = [{ sessionId: "s1", request: req({ method: "input", title: "mem", question: "?" }) }];
	const file = [
		{ sessionId: "s1", request: req({ method: "input", title: "file", question: "?" }) },
		{ sessionId: "s2", request: req({ method: "input", title: "f", question: "?" }) },
	];
	const out = unionPendingDialogs(memory, file);
	const s1 = out.filter((d) => d.sessionId === "s1");
	assert.equal(s1.length, 1, "同 id 只出现一次");
	assert.equal(s1[0].request.title, "mem", "file 与 memory 同 id 时只留 memory 那次");
});

test("unionPendingDialogs keeps memory first, then file", () => {
	const memory = [{ sessionId: "m1", request: req({ method: "input", title: "a", question: "?" }) }];
	const file = [
		{ sessionId: "f1", request: req({ method: "input", title: "b", question: "?" }) },
		{ sessionId: "f2", request: req({ method: "input", title: "c", question: "?" }) },
	];
	const out = unionPendingDialogs(memory, file);
	assert.deepEqual(
		out.map((d) => d.sessionId),
		["m1", "f1", "f2"],
		"保序：memory 先、file 后",
	);
});

test("empty file -> all memory retained", () => {
	const memory = [
		{ sessionId: "m1", request: req({ method: "input", title: "a", question: "?" }) },
		{ sessionId: "m2", request: req({ method: "input", title: "b", question: "?" }) },
	];
	const out = unionPendingDialogs(memory, []);
	assert.deepEqual(
		out.map((d) => d.sessionId),
		["m1", "m2"],
	);
});