// Pure helpers for parsing the `question` tool parameters.
//
// Kept as its own module (not inline in rpc-manager, which pulls in the pi SDK
// and Next.js internals) so this normalization logic is unit-testable without
// heavy imports — same reason tool-composition.ts lives on its own.
//
// The two UI tools share the *same* parameter surface:
//   - flat fields: title / header / question / message / placeholder / options
//   - or a Codex-style `questions: [{ header, question, placeholder, options }]`
//
// Goals (适应性 / robustness):
//   - options may be plain strings OR objects shaped as {label, description},
//     {value, description}, or just {description}; all are handled.
//   - never let a non-string leak through — the frontend renders each option as
//     text, so numbers/arrays/null/whitespace-only entries are dropped instead
//     of showing up as "[object Object]" or an empty button.
//   - surface the `description` as the option's secondary line (label + "\n" +
//     description) instead of silently discarding it.

/** Trim a value down to a non-blank string, or undefined if blank/missing. */
export function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Return the first Codex-style question object from `questions[]`, if any. */
export function firstQuestionRecord(
	params: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const questions = params.questions;
	if (!Array.isArray(questions)) return undefined;
	const first = questions[0];
	return first && typeof first === "object"
		? (first as Record<string, unknown>)
		: undefined;
}

/**
 * Normalize a raw `options` value into an array of display strings.
 *
 * - plain strings          -> trimmed as-is
 * - {label, description}   -> "label\ndescription" (heading + secondary line)
 * - {value, description}   -> same, with `value` as the heading
 * - {description} only     -> description alone
 * - {label | value} only   -> that heading alone
 *
 * Anything that isn't a non-blank string / compatible object is dropped.
 */
export function normalizeUiOptions(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed) out.push(trimmed);
			continue;
		}
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		const label =
			asNonEmptyString(record.label) ?? asNonEmptyString(record.value);
		const description = asNonEmptyString(record.description);
		if (label) {
			// 说明排在 label 后一行（前端 pre-line 渲染），不丢失括号/说明。
			out.push(description ? `${label}\n${description}` : label);
		} else if (description) {
			out.push(description);
		}
	}
	return out;
}

export interface ResolvedQuestionPart {
	title: string;
	question: string;
	placeholder?: string;
	options: string[];
}

// 向后兼容：单问解析结果的别名。
export type ResolvedQuestionRequest = ResolvedQuestionPart;

function resolveSingleQuestion(
	params: Record<string, unknown>,
	firstQuestions: Record<string, unknown> | undefined,
): ResolvedQuestionPart {
	const title =
		asNonEmptyString(params.title) ??
		asNonEmptyString(params.header) ??
		asNonEmptyString(firstQuestions?.header) ??
		"User input";
	const question =
		asNonEmptyString(params.question) ??
		asNonEmptyString(params.message) ??
		asNonEmptyString(firstQuestions?.question) ??
		title;
	const placeholder =
		asNonEmptyString(params.placeholder) ??
		asNonEmptyString(firstQuestions?.placeholder);
	const directOptions = normalizeUiOptions(params.options);
	const options =
		directOptions.length > 0
			? directOptions
			: normalizeUiOptions(firstQuestions?.options);

	return { title, question, placeholder, options };
}

/**
 * Resolve the dialog request from a tool-call's raw params, tolerating both
 * the `question` tool's flat fields and a single Codex-style question (`questions[0]`).
 *
 * Kept for backward compatibility / single-question callers.
 */
export function readQuestionRequest(
	params: Record<string, unknown>,
): ResolvedQuestionRequest {
	return resolveSingleQuestion(params, firstQuestionRecord(params));
}

/**
 * Resolve a possibly-multi-part question flow.
 *
 * The `question` tool accepts either flat fields or a
 * Codex-style `questions: [{header,question,placeholder,options}, ...]` array.
 *
 * 适配性：当传入多个 Codex 问题对象时，逐条解析成独立的部分返回，交给调用方
 * 顺序弹窗逐个收集答案，而不是只取 questions[0] 丢掉后面的。单问（扁平字段或
 * 仅一个 questions 项）时返回长度 1 的数组，行为不变。
 */
export function resolveQuestionParts(
	params: Record<string, unknown>,
): ResolvedQuestionPart[] {
	const questions = params.questions;
	const isBatch =
		Array.isArray(questions) && questions.length > 1;

	// 多问：每个 question 对象都要被呈现，逐个解析（不再只看第一个）。
	if (isBatch) {
		const parts: ResolvedQuestionPart[] = [];
		for (let i = 0; i < questions.length; i++) {
			const q = questions[i];
			if (!q || typeof q !== "object") continue;
			const rec = q as Record<string, unknown>;
			const title =
				asNonEmptyString(rec.header) ?? `Question ${i + 1}`;
			const question =
				asNonEmptyString(rec.question) ??
				asNonEmptyString(rec.message) ??
				title;
			parts.push({
				title,
				question,
				placeholder: asNonEmptyString(rec.placeholder),
				options: normalizeUiOptions(rec.options),
			});
		}
		return parts;
	}

	return [resolveSingleQuestion(params, firstQuestionRecord(params))];
}