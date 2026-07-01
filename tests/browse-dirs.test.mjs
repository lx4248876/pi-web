// Verifies the directory-listing filter used by GET /api/browse-dirs.
// Requirement: dot-prefixed directories (e.g. .pi, .agents) must be LISTABLE,
// while known junk dirs in SKIP_DIRS (e.g. .git, .next) must stay hidden.
//
// The route keeps listDir as an internal function, so we transpile the route
// module with the `typescript` compiler (devDep) and surface listDir/SKIP_DIRS
// without modifying production code for testability.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import {mkdirSync, mkdtempSync, rmSync} from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {readFile} from "node:fs/promises";
import {createContext, Script} from "node:vm";
import ts from "typescript";

async function loadRouteInternals() {
    const source = await readFile(
        new URL("../app/api/browse-dirs/route.ts", import.meta.url),
        "utf8",
    );
    const {outputText} = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    });
    // Neutralise runtime requires we don't want to actually pull in here:
    // next/server (unused by listDir), and alias fs/path/os to injected globals.
    // listDir/SKIP_DIRS are top-level declarations, so we can attach them after.
    const patched = outputText
        .replace(/require\(["']next\/server["']\)/g, "({ NextResponse: { json: () => ({}) } })")
        .replace(/require\(["']fs["']\)/g, "__fs")
        .replace(/require\(["']path["']\)/g, "__path")
        .replace(/require\(["']os["']\)/g, "__os")
        .concat("\nmodule.exports.listDir = listDir;\nmodule.exports.SKIP_DIRS = SKIP_DIRS;\n");

    const ctx = createContext({
        __fs: fs,
        __path: path,
        __os: os,
        module: {exports: {}},
        exports: {},
    });
    new Script(patched, {filename: "browse-dirs.test.js"}).runInContext(ctx);
    return ctx.module.exports;
}

test("listDir includes dot-directories but skips SKIP_DIRS entries", async () => {
    const {listDir} = await loadRouteInternals();
    const root = mkdtempSync(path.join(os.tmpdir(), "browse-dirs-"));
    try {
        for (const name of [".pi", ".agents", "real-project"]) {
            mkdirSync(path.join(root, name));
        }
        for (const name of [".git", ".next"]) {
            mkdirSync(path.join(root, name));
        }
        const names = listDir(root).map((e) => e.name).sort();

        assert.ok(names.includes(".pi"), `expected .pi listed, got ${JSON.stringify(names)}`);
        assert.ok(names.includes(".agents"), `expected .agents listed, got ${JSON.stringify(names)}`);
        assert.ok(names.includes("real-project"), `expected real-project listed, got ${JSON.stringify(names)}`);
        assert.ok(!names.includes(".git"), `.git must stay hidden, got ${JSON.stringify(names)}`);
        assert.ok(!names.includes(".next"), `.next must stay hidden, got ${JSON.stringify(names)}`);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
