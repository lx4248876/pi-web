import test from "node:test";
import assert from "node:assert/strict";
import { resolveLeafUnansweredQuestion } from "../lib/session-reader";
import type { SessionEntry } from "../lib/types";

// 测试用悬空的 question toolCall 走“原始”块形态(id/name/arguments)，与真实 jsonl
// 一致；运行时 helper 会通过 unknown 桥接，这里 cast 掉类型糖即可。
/* eslint-disable @typescript-eslint/no-explicit-any */
function toolCallBlockRaw(id: string, params: Record<string, unknown>): any {
	return { type: "toolCall", id, name: "question", arguments: params };
}

// 复现方向：会话在发出 question 后进程被杀/重启，留下一条"无对应 toolResult 的
// question toolCall"。打开该会话时，这个未答问题应该被重新识别出来，以便恢复弹窗。
// 心跳:
//   helper 应只关心当前叶子"最后一条 message"是否是一条未配对的 question toolCall,
//   且在已作答(有 toolResult)时返回 null,在问题之后又有后续消息时返回 null。

function base(partial: SessionEntry): SessionEntry {
	return partial;
}

function userMsg(id: string, parentId: string | null): SessionEntry {
	return base({
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00.000Z",
		message: { role: "user", content: "hello" },
	});
}

function assistantWithQuestion(
	id: string,
	parentId: string | null,
	toolCallId: string,
	params: Record<string, unknown>,
): SessionEntry {
	return base({
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00.001Z",
		message: {
			role: "assistant",
			model: "m",
			provider: "p",
			content: [
				{ type: "text", text: "请选择" },
				toolCallBlockRaw(toolCallId, params),
			],
		},
	});
}

function toolResultFor(
	id: string,
	parentId: string | null,
	toolCallId: string,
): SessionEntry {
	return base({
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00.002Z",
		message: {
			role: "toolResult",
			toolCallId,
			toolName: "question",
			content: [{ type: "text", text: "User selected: A" }],
		},
	});
}

test("leaf ends with an unanswered question toolCall -> recovered as a select dialog", () => {
	const entries = [
		userMsg("u1", null),
		assistantWithQuestion("a1", "u1", "call-q1", {
			header: "下期前端",
			question: "优先做哪块？",
			options: ["A：骨架表单化", "B：业务页"],
		}),
	];
	const found = resolveLeafUnansweredQuestion(entries);
	assert.ok(found, "应识别出叶子上的未答 question");
	assert.equal(found!.toolCallId, "call-q1");
	assert.equal(found!.request.method, "select");
	assert.equal(found!.request.title, "下期前端");
	assert.deepEqual(found!.request.options, ["A：骨架表单化", "B：业务页"]);
});

test("unanswered question without options -> recovered as an input dialog", () => {
	const entries = [
		userMsg("u1", null),
		assistantWithQuestion("a1", "u1", "call-q2", {
			question: "请给出你的答案",
			placeholder: "例如……",
		}),
	];
	const found = resolveLeafUnansweredQuestion(entries);
	assert.ok(found);
	assert.equal(found!.request.method, "input");
	assert.equal(found!.request.question, "请给出你的答案");
	assert.equal(found!.request.placeholder, "例如……");
});

test("already-answered question (matching toolResult present) -> not recovered", () => {
	const entries = [
		userMsg("u1", null),
		assistantWithQuestion("a1", "u1", "call-q1", {
			question: "选一个",
			options: ["A", "B"],
		}),
		toolResultFor("t1", "a1", "call-q1"),
	];
	assert.equal(resolveLeafUnansweredQuestion(entries), null);
});

test("question is not the last message (session continued) -> not recovered", () => {
	const entries = [
		userMsg("u1", null),
		assistantWithQuestion("a1", "u1", "call-q1", {
			question: "选一个",
			options: ["A", "B"],
		}),
		userMsg("u2", "a1"),
	];
	assert.equal(resolveLeafUnansweredQuestion(entries), null);
});

test("last message is not assistant -> not recovered", () => {
	const entries = [userMsg("u1", null), assistantWithQuestion("a1", "u1", "call-q1", { question: "x" }), userMsg("u2", "a1")];
	assert.equal(resolveLeafUnansweredQuestion(entries), null);
});

test("normalized block shape (toolCallId/toolName/input) is also recognized", () => {
	const entries = [
		userMsg("u1", null),
		base({
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "2025-01-01T00:00:00.001Z",
			message: {
				role: "assistant",
				model: "m",
				provider: "p",
				content: [
					{
						type: "toolCall",
						toolCallId: "call-n1",
						toolName: "question",
						input: { question: "多选?", options: ["是", "否"] },
					},
				],
			},
		}),
	];
	const found = resolveLeafUnansweredQuestion(entries);
	assert.ok(found);
	assert.equal(found!.request.method, "select");
	assert.deepEqual(found!.request.options, ["是", "否"]);
});

test("empty / no-message entries -> null", () => {
	assert.equal(resolveLeafUnansweredQuestion([]), null);
});

test("multi-question questions[] -> recovered as a multiple dialog", () => {
	const entries = [
		userMsg("u1", null),
		assistantWithQuestion("a1", "u1", "call-multi", {
			questions: [
				{ header: "Q1", question: "框架？", options: ["Vue", "React"] },
				{ header: "Q2", question: "仓库？", placeholder: "url" },
			],
		}),
	];
	const found = resolveLeafUnansweredQuestion(entries);
	assert.ok(found);
	assert.equal(found!.request.method, "multiple");
	assert.ok(Array.isArray(found!.request.questions));
	assert.equal(found!.request.questions!.length, 2);
	assert.equal(found!.request.questions![0].question, "框架？");
	assert.deepEqual(found!.request.questions![0].options, ["Vue", "React"]);
});

test("already-answered multi-question is not recovered", () => {
	const entries = [
		userMsg("u1", null),
		assistantWithQuestion("a1", "u1", "call-multi", {
			questions: [{ question: "A?" }, { question: "B?" }],
		}),
		toolResultFor("t1", "a1", "call-multi"),
	];
	assert.equal(resolveLeafUnansweredQuestion(entries), null);
});