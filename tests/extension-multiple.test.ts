import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 用相对路径导入：jiti 不解析 tsconfig 的 @/ 别名
import { startRpcSession } from "../lib/rpc-manager";
import type { ResolvedQuestionPart } from "../lib/question-options";

function setup() {
	const cwd = mkdtempSync(join(tmpdir(), "pi-web-multi-"));
	const agentDir = mkdtempSync(join(tmpdir(), "pi-web-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(agentDir, "sessions"), { recursive: true });
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));
	return { cwd, agentDir };
}

const PARTS: ResolvedQuestionPart[] = [
	{
		title: "问题 1",
		question: "你希望默认列出几档常用牌号？",
		options: ["只看 3 档常用\n面板更简洁", "列出全部匹配\n一次看全"],
	},
	{
		title: "问题 2",
		question: "抓取不全时优先怎么处理？",
		placeholder: "描述一下",
		options: [],
	},
];

test("ctx.ui.multiple emits a real extension_ui_request and resolves value:string[]", async () => {
	const { cwd, agentDir } = setup();
	let session:
		| Awaited<ReturnType<typeof startRpcSession>>["session"]
		| undefined;
	try {
		const started = await startRpcSession("test-session", "", cwd, []);
		session = started.session;
		// 真实通道：multiple() 会发一个 method:"multiple" 的 request 并等待应答
		const promise = session.createExtensionUIContext().multiple(PARTS);

		const unsubscribe = session.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as never as { method: string }).method === "multiple" &&
				(event as never as { id?: string }).id
			) {
				const req = event as never as {
					id: string;
					questions: ResolvedQuestionPart[];
				};
				// 断言后端发送的载荷带了全部问题（不再只 loss 成第一个）
				assert.strictEqual(req.questions.length, 2);
				assert.strictEqual(req.questions[1].question, "抓取不全时优先怎么处理？");
				session!.send({
					type: "extension_ui_response",
					id: req.id,
					value: ["只看 3 档常用\n面板更简洁", "优先去反爬侧排查"],
				});
			}
		});

		const answers = await Promise.race([
			promise,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 3000),
			),
		]);
		unsubscribe();
		assert.deepEqual(answers, [
			"只看 3 档常用\n面板更简洁",
			"优先去反爬侧排查",
		]);
	} finally {
		session?.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("ctx.ui.multiple resolves undefined on cancel", async () => {
	const { cwd, agentDir } = setup();
	let session:
		| Awaited<ReturnType<typeof startRpcSession>>["session"]
		| undefined;
	try {
		const started = await startRpcSession("test-session", "", cwd, []);
		session = started.session;
		const promise = session.createExtensionUIContext().multiple(PARTS);

		const unsubscribe = session.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as never as { method: string }).method === "multiple" &&
				(event as never as { id?: string }).id
			) {
				session!.send({
					type: "extension_ui_response",
					id: (event as never as { id: string }).id,
					cancelled: true,
				});
			}
		});

		const answers = await Promise.race([
			promise,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 3000),
			),
		]);
		unsubscribe();
		assert.strictEqual(answers, undefined);
	} finally {
		session?.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});