import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  return import(new URL("../lib/agent-message-merge.ts", import.meta.url).href);
}

test("completed user echo does not duplicate an optimistic user message", async () => {
  const { appendCompletedMessage } = await loadModule();
  const optimistic = { role: "user", content: "hello", timestamp: 1 };
  const completed = { role: "user", content: "hello", timestamp: 2 };

  const messages = appendCompletedMessage([optimistic], completed);

  assert.deepStrictEqual(messages, [optimistic]);
});

test("completed user message still appends when there is no optimistic match", async () => {
  const { appendCompletedMessage } = await loadModule();
  const assistant = { role: "assistant", content: [{ type: "text", text: "ready" }], model: "m", provider: "p" };
  const completed = { role: "user", content: "next" };

  const messages = appendCompletedMessage([assistant], completed);

  assert.deepStrictEqual(messages, [assistant, completed]);
});

test("completed assistant message always appends", async () => {
  const { appendCompletedMessage } = await loadModule();
  const user = { role: "user", content: "hello", timestamp: 1 };
  const completed = { role: "assistant", content: [{ type: "text", text: "done" }], model: "m", provider: "p" };

  const messages = appendCompletedMessage([user], completed);

  assert.deepStrictEqual(messages, [user, completed]);
});
