import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setTrashedSessions,
  readUiState,
  setHiddenCwds,
} from "../lib/ui-state";

function withAgentDir<T>(fn: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-trash-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  mkdirSync(join(dir, "sessions"), { recursive: true });
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("setTrashedSessions persists ids and preserves hiddenCwds", () => {
  withAgentDir(() => {
    setHiddenCwds({ "C:/x": true });
    const saved = setTrashedSessions(["s1", "s2"]);
    assert.deepStrictEqual([...saved.trashedSessions], ["s1", "s2"]);
    assert.deepStrictEqual(saved.hiddenCwds, { "C:/x": true });

    const re = readUiState();
    assert.deepStrictEqual([...re.trashedSessions], ["s1", "s2"]);
    assert.deepStrictEqual(re.hiddenCwds, { "C:/x": true });
  });
});

test("readUiState treats missing trashedSessions as empty and keeps hiddenCwds", () => {
  withAgentDir(() => {
    const state = readUiState();
    assert.deepStrictEqual([...state.trashedSessions], []);
    assert.deepStrictEqual(state.hiddenCwds, {});
  });
});