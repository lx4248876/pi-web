import test from "node:test";
import assert from "node:assert/strict";
import {
	asNonEmptyString,
	firstQuestionRecord,
	normalizeUiOptions,
	readQuestionRequest,
	resolveQuestionParts,
} from "../lib/question-options";

test("normalizeUiOptions keeps a plain string option", () => {
	assert.deepEqual(normalizeUiOptions(["a", " b ", ""]), ["a", "b"]);
});

test("normalizeUiOptions joins label + description as a secondary line", () => {
	assert.deepEqual(
		normalizeUiOptions([
			{ label: "是：只看常用几档", description: "那就保持现状，不去改" },
		]),
		["是：只看常用几档\n那就保持现状，不去改"],
	);
});

test("normalizeUiOptions treats `value` as the heading when label is absent", () => {
	assert.deepEqual(
		normalizeUiOptions([{ value: "Option A", description: "detail A" }]),
		["Option A\ndetail A"],
	);
});

test("normalizeUiOptions surfaces description-only options", () => {
	assert.deepEqual(
		normalizeUiOptions([{ description: "只有说明，没有主标题" }]),
		["只有说明，没有主标题"],
	);
});

test("normalizeUiOptions keeps heading when description missing", () => {
	assert.deepEqual(
		normalizeUiOptions([{ label: "headline only" }]),
		["headline only"],
	);
});

test("normalizeUiOptions drops empty/object/whitespace/non-string junk", () => {
	assert.deepEqual(
		normalizeUiOptions([
			"",
			"   ",
			123,
			null,
			undefined,
			[],
			{ label: "   " },
			{ description: undefined },
		]),
		[],
	);
});

test("normalizeUiOptions returns [] for non-array input", () => {
	assert.deepEqual(normalizeUiOptions(undefined), []);
	assert.deepEqual(normalizeUiOptions("nope"), []);
	assert.deepEqual(normalizeUiOptions({ label: "x" }), []);
});

test("asNonEmptyString trims and ignores blanks", () => {
	assert.strictEqual(asNonEmptyString(" hi "), "hi");
	assert.strictEqual(asNonEmptyString(""), undefined);
	assert.strictEqual(asNonEmptyString(0), undefined);
	assert.strictEqual(asNonEmptyString(null), undefined);
});

test("firstQuestionRecord reads the head of questions[]", () => {
	assert.deepEqual(firstQuestionRecord({ questions: [{ question: "q" }] }), {
		question: "q",
	});
	assert.strictEqual(firstQuestionRecord({}), undefined);
	assert.strictEqual(firstQuestionRecord({ questions: [] }), undefined);
	assert.strictEqual(firstQuestionRecord({ questions: [1] }), undefined);
});

test("readQuestionRequest prefers flat fields over questions[]", () => {
	const resolved = readQuestionRequest({
		title: "FlatTitle",
		question: "Flat Q",
		options: [
			{ label: "Flat A", description: "flat detail" },
		],
		questions: [{ header: "CodexHeader", question: "Codex Q" }],
	});
	assert.strictEqual(resolved.title, "FlatTitle");
	assert.strictEqual(resolved.question, "Flat Q");
	assert.deepEqual(resolved.options, ["Flat A\nflat detail"]);
});

test("readQuestionRequest falls back to Codex-style questions[]", () => {
	const resolved = readQuestionRequest({
		questions: [
			{
				header: "确认",
				question: "你说的“数量很少”在哪看到的？",
				placeholder: "输入描述",
				options: [
					{ label: "A", description: "说明 A" },
					"B",
					{ value: "C" },
				],
			},
		],
	});
	assert.strictEqual(resolved.title, "确认");
	assert.strictEqual(resolved.question, "你说的“数量很少”在哪看到的？");
	assert.strictEqual(resolved.placeholder, "输入描述");
	assert.deepEqual(resolved.options, ["A\n说明 A", "B", "C"]);
});

test("readQuestionRequest falls back to message/title when question is absent", () => {
	assert.strictEqual(
		readQuestionRequest({ title: "T", message: "M" }).question,
		"M",
	);
	assert.strictEqual(
		readQuestionRequest({ header: "H" }).question,
		"H",
	);
	assert.strictEqual(readQuestionRequest({}).title, "User input");
	assert.strictEqual(readQuestionRequest({}).question, "User input");
});

test("resolveQuestionParts returns one part for flat / single-question input", () => {
	const parts = resolveQuestionParts({
		question: "Q",
		options: [{ label: "A", description: "d" }],
	});
	assert.strictEqual(parts.length, 1);
	assert.deepEqual(parts, [
		{ title: "User input", question: "Q", placeholder: undefined, options: ["A\nd"] },
	]);
});

test("resolveQuestionParts resolves each object independently for multiple questions", () => {
	const parts = resolveQuestionParts({
		questions: [
			{ header: "Q1", question: "问题 1：选档？", options: [{ label: "只看常用的", description: "简洁" }, "全列"] },
			{ header: "Q2", question: "问题 2：抓取不全怎么办？", placeholder: "描述一下" },
			{ question: "问题 3：要长期生效吗？", options: [{ label: "要", description: "存为默认" }, { label: "不要" }] },
		],
	});
	assert.deepEqual(parts, [
		{ title: "Q1", question: "问题 1：选档？", placeholder: undefined, options: ["只看常用的\n简洁", "全列"] },
		{ title: "Q2", question: "问题 2：抓取不全怎么办？", placeholder: "描述一下", options: [] },
		{ title: "Question 3", question: "问题 3：要长期生效吗？", placeholder: undefined, options: ["要\n存为默认", "不要"] },
	]);
});

test("resolveQuestionParts ignores non-object entries in a batch", () => {
	const parts = resolveQuestionParts({
		questions: [{ question: "A?" }, "junk", 42, null, { header: "B", options: ["x"] }],
	});
	assert.strictEqual(parts.length, 2);
	assert.strictEqual(parts[0].question, "A?");
	assert.strictEqual(parts[1].title, "B");
	assert.deepEqual(parts[1].options, ["x"]);
});