// Verifies the extension-tool inclusion logic in lib/tool-composition.ts.
// Requirement: installed extension tools (e.g. "subagent") must stay available
// alongside built-in tools, EXCEPT when the user picks the "Off" preset (empty
// toolNames), which means truly everything off — no extension tools either.
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {readFile} from "node:fs/promises";
import {createContext, Script} from "node:vm";

// tool-composition.ts is dependency-free, but it's authored in TypeScript, so we
// transpile it and run it in a vm sandbox to exercise it as plain JS — same
// technique as browse-dirs.test.mjs.
async function loadInternals() {
    const source = await readFile(
        new URL("../lib/tool-composition.ts", import.meta.url),
        "utf8",
    );
    const {outputText} = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    });
    // CommonJS modules mutate `exports` / `module.exports`; they must alias the
    // same object so the transpiled `exports.foo = ...` lands where we read it.
    const moduleObj = {exports: {}};
    const ctx = createContext({module: moduleObj, exports: moduleObj.exports});
    new Script(outputText, {filename: "tool-composition.test.js"}).runInContext(ctx);
    return ctx.module.exports;
}

// Fake ToolInfo shape matching the SDK's getAllTools() return value.
const tool = (name) => ({name});

test("extensionToolNamesOf filters out built-in + UI-compat tools, keeps extensions", async () => {
    const {extensionToolNamesOf} = await loadInternals();
    const registry = [
        tool("read"), tool("bash"), tool("edit"), tool("write"),
        tool("grep"), tool("find"), tool("ls"),
        tool("question"),
        tool("subagent"), tool("TodoWrite"), tool("pi-lens"),
    ];
    const ext = extensionToolNamesOf(registry);
    assert.deepEqual([...ext].sort(), ["TodoWrite", "pi-lens", "subagent"]);
});

test("composeActiveTools merges requested built-ins with extension tools (non-off preset)", async () => {
    const {composeActiveTools} = await loadInternals();
    const registry = [
        tool("read"), tool("bash"), tool("subagent"), tool("pi-lens"),
    ];
    // Preset "default" = read/bash/edit/write. Extensions must be auto-included.
    const active = composeActiveTools(["read", "bash", "edit", "write"], registry);
    assert.ok(active.includes("read"), "built-in read must be present");
    assert.ok(active.includes("subagent"), "subagent must be auto-included");
    assert.ok(active.includes("pi-lens"), "pi-lens must be auto-included");
    assert.ok(active.includes("question"), "UI-compat tool must be added");
});

test("composeActiveTools returns [] for the Off preset (everything truly off)", async () => {
    const {composeActiveTools} = await loadInternals();
    const registry = [tool("read"), tool("subagent")];
    const active = composeActiveTools([], registry);
    // Compare by length + content instead of deepStrictEqual: the array is built
    // inside a vm sandbox (different realm), so prototype-sensitive strict checks
    // would false-fail on an empty array.
    assert.equal(active.length, 0, "Off preset must disable extension tools too");
});
