import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createContext, Script } from "node:vm";

async function loadRpcManagerInternals() {
	const source = await readFile(
		new URL("../lib/rpc-manager.ts", import.meta.url),
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
			if (specifier === "node:crypto") return { randomUUID: () => "id" };
			if (specifier === "@earendil-works/pi-coding-agent") {
				return {
					defineTool: (tool) => tool,
					createAgentSession: async () => {
						throw new Error("unused");
					},
					SessionManager: {},
					Theme: class Theme {
						constructor() {}
					},
				};
			}
			if (specifier === "typebox") return { Type: new Proxy({}, { get: () => () => ({}) }) };
			if (specifier === "./session-reader") return { cacheSessionPath: () => {} };
			if (specifier === "./tool-composition") return { composeActiveTools: () => [] };
			if (specifier === "./question-options")
				return {
					readQuestionRequest: () => ({ title: "", question: "", options: [] }),
					resolveQuestionParts: () => [
						{ title: "", question: "", options: [] },
					],
				};
			throw new Error(`Unexpected require: ${specifier}`);
		},
		setTimeout,
		clearTimeout,
		console,
	});
	new Script(outputText, { filename: "rpc-manager.test.js" }).runInContext(ctx);
	return ctx.module.exports;
}

test("guardRpcExtensionStartupHandlers times out stuck startup handlers", async () => {
	const { guardRpcExtensionStartupHandlers } = await loadRpcManagerInternals();
	const runner = {
		extensions: [
			{
				path: "stuck-extension",
				handlers: new Map([
					["session_start", [() => new Promise(() => {})]],
				]),
			},
		],
	};

	guardRpcExtensionStartupHandlers(runner, 20);

	await assert.rejects(
		runner.extensions[0].handlers.get("session_start")[0]({}, {}),
		/RPC extension startup handler timed out after 20ms/,
	);
});
