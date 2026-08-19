import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanChildSessions, isChildSessionPathIn } from "../lib/session-reader";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-web-child-"));
}

function makeSessionFile(dir: string, id: string, opts?: { parentSession?: string; userText?: string }) {
  const header: Record<string, unknown> = {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/work",
  };
  if (opts?.parentSession) header.parentSession = opts.parentSession;
  const lines: string[] = [];
  lines.push(JSON.stringify(header));
  if (opts?.userText) {
    lines.push(JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: opts.userText } }));
  }
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

test("scanChildSessions finds nested child session files two levels deep (async-*)", () => {
  const root = tmp();
  try {
    // Top-level session file (what listAll already covers - must NOT be reported)
    const parentFile = makeSessionFile(root, "parent123", { userText: "hello" });
    // Child: sessions/PARENTID/async-<runid>/<timestamp>_<id>.jsonl
    const childDir = join(root, "parent123", "async-run1");
    mkdirSync(childDir, { recursive: true });
    const childFile = makeSessionFile(childDir, "child999", { parentSession: parentFile });

    const result = scanChildSessions(root);
    assert.equal(result.length, 1, "only the nested child should be reported");
    assert.equal(result[0]!.id, "child999");
    assert.equal(result[0]!.path, childFile);
    assert.equal(result[0]!.parentSessionPath, parentFile);
    assert.equal(result[0]!.cwd, "/work");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanChildSessions does NOT report top-level or one-level files (listAll already covers those)", () => {
  const root = tmp();
  try {
    const parentFile = makeSessionFile(root, "parentA", { userText: "hi" });
    // One-level subdir with a session directly inside (grouped; listAll sees it)
    const groupDir = join(root, "grouped");
    mkdirSync(groupDir, { recursive: true });
    makeSessionFile(groupDir, "groupped001", { parentSession: parentFile });

    const result = scanChildSessions(root);
    // Neither top-level `parentA.jsonl` nor the one-level grouped session should appear.
    assert.equal(result.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanChildSessions handles chain-* run subdirs and missing sessions dir", () => {
  const root = tmp();
  try {
    const parentFile = makeSessionFile(root, "parentChain", {});
    const chainDir = join(root, "parentChain", "chain-runs");
    mkdirSync(chainDir, { recursive: true });
    makeSessionFile(chainDir, "chainChild", { parentSession: parentFile });

    const result = scanChildSessions(root);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "chainChild");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // Missing dir -> empty, no throw
  assert.deepEqual(scanChildSessions(join(tmp(), "does-not-exist")), []);
});

test("isChildSessionPathIn flags nested child files but not top-level sessions (red-line guard)", () => {
  const root = tmp();
  try {
    const parentFile = makeSessionFile(root, "parentRL", { userText: "hi" });
    const runDir = join(root, "parentRL", "async-77");
    mkdirSync(runDir, { recursive: true });
    const childFile = makeSessionFile(runDir, "childRL", { parentSession: parentFile });

    assert.equal(isChildSessionPathIn(root, childFile), true, "child file must be recognized as browse-only");
    assert.equal(isChildSessionPathIn(root, parentFile), false, "top-level session file must NOT be flagged");
    assert.equal(isChildSessionPathIn(root, join(root, "nope.jsonl")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanChildSessions ignores broken / non-session jsonl lines gracefully", () => {
  const root = tmp();
  try {
    const runDir = join(root, "parentX", "async-9");
    mkdirSync(runDir, { recursive: true });
    const bad = join(runDir, "junk.jsonl");
    writeFileSync(bad, 'not valid json\n', "utf8");

    const result = scanChildSessions(root);
    assert.equal(result.length, 0, "unparseable file should be skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});