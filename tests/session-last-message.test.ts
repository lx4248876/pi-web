import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionLastMessage } from "../lib/session-reader";

function fixture(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-last-"));
  writeFileSync(join(dir, "s.jsonl"), lines.join("\n"), "utf8");
  return dir;
}

test("lastMessage extracts text from the final message (block content)", () => {
  const dir = fixture([
    '{"type":"session","id":"a","timestamp":"2025-01-01T00:00:00.000Z"}',
    '{"type":"message","timestamp":"2025-01-01T00:00:00.001Z","message":{"role":"user","content":"hello first"}}',
    '{"type":"message","timestamp":"2025-01-01T00:00:00.002Z","message":{"role":"assistant","content":[{"type":"text","text":"the LAST sentence"}]}}',
  ]);
  try {
    assert.equal(readSessionLastMessage(join(dir, "s.jsonl")), "the LAST sentence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lastMessage handles string content", () => {
  const dir = fixture([
    '{"type":"session","id":"b","timestamp":"2025-01-01T00:00:00.000Z"}',
    '{"type":"message","timestamp":"2025-01-01T00:00:00.001Z","message":{"role":"user","content":"plain string last message"}}',
  ]);
  try {
    assert.equal(
      readSessionLastMessage(join(dir, "s.jsonl")),
      "plain string last message",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lastMessage is empty when no message entry exists", () => {
  const dir = fixture(['{"type":"session","id":"c","timestamp":"2025-01-01T00:00:00.000Z"}']);
  try {
    assert.equal(readSessionLastMessage(join(dir, "s.jsonl")), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});