import test from "node:test";
import assert from "node:assert/strict";
import { extractArtifacts, orderedArtifactOpen } from "../lib/artifacts";
import type { AgentMessage } from "@/lib/types";

// Minimal fixture helpers (type-correct literal messages)
function write(file_path: string, toolCallId = `w-${file_path}`): AgentMessage {
  return {
    role: "assistant",
    model: "test",
    provider: "test",
    content: [
      { type: "toolCall", toolCallId, toolName: "write", input: { file_path } },
    ],
  };
}

function edit(path: string, toolCallId = `e-${path}`): AgentMessage {
  return {
    role: "assistant",
    model: "test",
    provider: "test",
    content: [
      { type: "toolCall", toolCallId, toolName: "edit", input: { path } },
    ],
  };
}

function result(toolCallId: string, isError = false): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    content: [],
    ...(isError ? { isError: true } : {}),
  };
}

test("#1 write with input.file_path is collected", () => {
  const out = extractArtifacts([write("src/a.ts")]);
  assert.deepEqual(out, ["src/a.ts"]);
});

test("#2 write + edit collect both", () => {
  const out = extractArtifacts([write("src/a.ts"), edit("src/b.ts")]);
  assert.deepEqual(out, ["src/a.ts", "src/b.ts"]);
});

test("#3 same path written twice is deduped (first occurrence order)", () => {
  const out = extractArtifacts([
    write("src/a.ts"),
    write("src/a.ts"),
    edit("src/b.ts"),
  ]);
  assert.deepEqual(out, ["src/a.ts", "src/b.ts"]);
});

test("#4 edit uses input.path fallback", () => {
  const out = extractArtifacts([edit("docs/notes.md")]);
  assert.deepEqual(out, ["docs/notes.md"]);
});

test("#5 corresponding toolResult with isError:true excludes the file", () => {
  const out = extractArtifacts([write("src/bad.ts", "w1"), result("w1", true)]);
  assert.deepEqual(out, []);
});

test("#5b error for one call in a turn only excludes that one", () => {
  const out = extractArtifacts([
    write("src/good.ts", "w1"),
    edit("src/bad.ts", "w2"),
    result("w2", true),
  ]);
  assert.deepEqual(out, ["src/good.ts"]);
});

test("#6 read / bash toolCalls are not collected", () => {
  const out = extractArtifacts([
    write("src/a.ts"),
    {
      role: "assistant",
      model: "test",
      provider: "test",
      content: [
        {
          type: "toolCall",
          toolCallId: "r1",
          toolName: "read",
          input: { file_path: "src/readme.ts" },
        },
        {
          type: "toolCall",
          toolCallId: "b1",
          toolName: "bash",
          input: { command: "echo hi" },
        },
      ],
    },
  ]);
  assert.deepEqual(out, ["src/a.ts"]);
});

test("#7 empty or no-write tool messages yield []", () => {
  assert.deepEqual(extractArtifacts([]), []);
  assert.deepEqual(
    extractArtifacts([
      {
        role: "assistant",
        model: "test",
        provider: "test",
        content: [],
      },
    ]),
    [],
  );
});

test("#7b non-string / missing file path input is skipped", () => {
  const out = extractArtifacts([
    {
      role: "assistant",
      model: "test",
      provider: "test",
      content: [
        {
          type: "toolCall",
          toolCallId: "no1",
          toolName: "write",
          input: {},
        },
        {
          type: "toolCall",
          toolCallId: "no2",
          toolName: "write",
          input: { file_path: 12345 },
        },
      ],
    },
  ]);
  assert.deepEqual(out, []);
});

test("#8 orderedArtifactOpen keeps others then the active path last", () => {
  const arts = [
    { path: "a.ts", name: "a.ts" },
    { path: "b.ts", name: "b.ts" },
    { path: "c.ts", name: "c.ts" },
  ];
  const out = orderedArtifactOpen(arts, "b.ts");
  assert.deepEqual(out.map((f) => f.path), ["a.ts", "c.ts", "b.ts"]);
});

test("#8b active path not in list keeps original order (active appended requires match)", () => {
  const arts = [{ path: "a.ts", name: "a.ts" }, { path: "b.ts", name: "b.ts" }];
  const out = orderedArtifactOpen(arts, "zz.ts");
  // no matching active -> keep original order, nothing becomes "active"
  assert.deepEqual(out.map((f) => f.path), ["a.ts", "b.ts"]);
});

test("#8c single-artifact list is unchanged and order stable", () => {
  const arts = [{ path: "a.ts", name: "a.ts" }];
  const out = orderedArtifactOpen(arts, "a.ts");
  assert.deepEqual(out.map((f) => f.path), ["a.ts"]);
});