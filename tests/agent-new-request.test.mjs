import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createContext, Script } from "node:vm";

async function loadModule() {
	return import(new URL("../lib/agent-new-request.ts", import.meta.url).href);
}

async function loadFlowModule() {
	const requestExports = await loadModule();
	const source = await readFile(
		new URL("../lib/agent-new-flow.ts", import.meta.url),
		"utf8",
	);
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
		},
	});
	const moduleObj = { exports: {} };
	const ctx = createContext({
		module: moduleObj,
		exports: moduleObj.exports,
		require(specifier) {
			if (specifier === "fs") return { existsSync: () => true };
			if (specifier === "node:crypto") return { randomUUID: () => "test-uuid" };
			if (specifier === "./agent-new-request") return requestExports;
			throw new Error(`Unexpected require: ${specifier}`);
		},
		Date,
		globalThis,
	});
	new Script(outputText, { filename: "agent-new-flow.test.js" }).runInContext(ctx);
	return ctx.module.exports;
}

test("create request only starts a session and does not build a prompt command", async () => {
	const { parseAgentNewRequest } = await loadModule();

	const parsed = parseAgentNewRequest({
		cwd: "C:\\project",
		type: "create",
		message: "hello",
		toolNames: ["read"],
		provider: "go",
		modelId: "kimi-k2.7-code",
		thinkingLevel: "off",
	});

	assert.equal(parsed.cwd, "C:\\project");
	assert.deepEqual(parsed.toolNames, ["read"]);
	assert.equal(parsed.provider, "go");
	assert.equal(parsed.modelId, "kimi-k2.7-code");
	assert.equal(parsed.thinkingLevel, "off");
	assert.equal(parsed.promptCommand, null);
});

test("prompt request preserves the command for backward compatibility", async () => {
	const { parseAgentNewRequest } = await loadModule();

	const parsed = parseAgentNewRequest({
		cwd: "C:\\project",
		type: "prompt",
		message: "hello",
		toolNames: ["read"],
	});

	assert.deepEqual(parsed.promptCommand, { type: "prompt", message: "hello" });
});

test("createNewAgentSession does not send the first prompt for create requests", async () => {
	const { createNewAgentSession } = await loadFlowModule();
	const calls = [];
	const session = {
		send(command) {
			calls.push(command);
			return Promise.resolve(null);
		},
	};

	const result = await createNewAgentSession(
		{
			cwd: process.cwd(),
			type: "create",
			message: "this must not be sent here",
			provider: "go",
			modelId: "kimi-k2.7-code",
			thinkingLevel: "off",
			toolNames: ["read"],
		},
		async () => ({ session, realSessionId: "session-1" }),
	);

	assert.equal(result.status, 200);
	assert.equal(result.body.sessionId, "session-1");
	assert.equal(JSON.stringify(calls), JSON.stringify([
		{ type: "set_model", provider: "go", modelId: "kimi-k2.7-code" },
		{ type: "set_thinking_level", level: "off" },
	]));
});
