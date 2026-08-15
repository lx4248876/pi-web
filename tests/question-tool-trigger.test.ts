import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 用相对路径导入：jiti 不解析 tsconfig 的 @/ 别名
import { createCompatUiTools, startRpcSession } from "../lib/rpc-manager";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// question 工具的 execute 只读 ctx.ui；这里用真实 session 的 UI 上下文，
// 其余字段对本次触发测试无意义，仅做类型补全。
function uiCtx(ui: { select: unknown; multiple: unknown; input: unknown; confirm: unknown; notify: unknown }) {
	return { ui } as unknown as ExtensionContext;
}

function setup() {
	const cwd = mkdtempSync(join(tmpdir(), "pi-web-question-"));
	const agentDir = mkdtempSync(join(tmpdir(), "pi-web-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(agentDir, "sessions"), { recursive: true });
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));
	return { cwd, agentDir };
}

// 只有一个问用户工具，名字必须是 `question`，不允许再出现旧的重复别名。
test("createCompatUiTools exposes exactly one tool named `question`", () => {
	const tools = createCompatUiTools();
	assert.equal(tools.length, 1, "must be exactly one tool");
	assert.equal(tools[0]!.name, "question");
	assert.ok(
		!tools.some(
			(t) => t.name === "AskUserQuestion" || t.name === "request_user_input",
		),
		"no legacy duplicate aliases allowed",
	);
});

// 单问题+options：点 `question` 工具 → 真实通道 emit extension_ui_request(select)
// → 前端组件回 value → execute 解析成「User selected: …」。
test("`question` tool triggers a select dialog via runtime UI channel", async () => {
	const { cwd, agentDir } = setup();
	let session:
		| Awaited<ReturnType<typeof startRpcSession>>["session"]
		| undefined;
	try {
		const started = await startRpcSession("test-session", "", cwd, []);
		session = started.session;
		const tool = createCompatUiTools().find((t) => t.name === "question")!;
		const ui = session.createExtensionUIContext();

		const execute = tool.execute!(
			"call_1",
			{ question: "继续用默认牌号列表吗？", options: ["用默认", "自定义"] },
			undefined,
			undefined,
			uiCtx(ui),
		);

		const unsubscribe = session.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as never as { method: string }).method === "select" &&
				(event as never as { id?: string }).id
			) {
				const req = event as never as {
					id: string;
					title: string;
					options: string[];
				};
				// 组件接收到的载荷 = question + 全部 options
				assert.equal(req.title, "继续用默认牌号列表吗？");
				assert.deepEqual(req.options, ["用默认", "自定义"]);
				session!.send({
					type: "extension_ui_response",
					id: req.id,
					value: "用默认",
				});
			}
		});

		const result = await Promise.race([
			execute,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("select timeout")), 3000),
			),
		]);
		unsubscribe();
		const text = (result as { content: { text: string }[] }).content[0]!.text;
		assert.equal(text, "User selected: 用默认");
	} finally {
		session?.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

// 多问题（questions[]）：`question` 工具 → method:"multiple" 的请求 → 回数组 →
// 解析成逐条「User answered: …」。覆盖第 3 分支，防止以后只保住 select 分支。
test("`question` tool triggers a multi-question dialog via runtime UI channel", async () => {
	const { cwd, agentDir } = setup();
	let session:
		| Awaited<ReturnType<typeof startRpcSession>>["session"]
		| undefined;
	try {
		const started = await startRpcSession("test-session", "", cwd, []);
		session = started.session;
		const tool = createCompatUiTools().find((t) => t.name === "question")!;
		const ui = session.createExtensionUIContext();

		const execute = tool.execute!(
			"call_2",
			{
				questions: [
					{ question: "默认几档？", options: ["3 档", "全列"] },
					{ question: "抓取不全怎么办？", placeholder: "描述" },
				],
			},
			undefined,
			undefined,
			uiCtx(ui),
		);

		const unsubscribe = session.onEvent((event) => {
			if (
				event.type === "extension_ui_request" &&
				(event as never as { method: string }).method === "multiple" &&
				(event as never as { id?: string }).id
			) {
				const req = event as never as {
					id: string;
					questions: { question: string }[];
				};
				assert.equal(req.questions.length, 2);
				session!.send({
					type: "extension_ui_response",
					id: req.id,
					value: ["3 档", "优先反爬侧排查"],
				});
			}
		});

		const result = await Promise.race([
			execute,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("multiple timeout")), 3000),
			),
		]);
		unsubscribe();
		const text = (result as { content: { text: string }[] }).content[0]!.text;
		assert.equal(
			text,
			"User answered:\n默认几档？ -> 3 档\n抓取不全怎么办？ -> 优先反爬侧排查",
		);
	} finally {
		session?.destroy();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});