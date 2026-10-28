// 跨重启恢复的「未答 question」在用户作答后该如何落盘（实测发现的问题）。
//
// 现状（修复前）：作答后 append 一条 role:"user" 的消息。真机跑一轮后可以看到发给
// 模型的 messages 变成：
//   ... assistant(带 toolCall question) > user(答案) > user(新提问)
// 即 assistant 的 toolCall 永远没有配对的 tool 结果，后面还叠了两条 user。真实
// OpenAI 兼容端点会因此 400（"tool_calls must be followed by tool messages"）。
//
// 正确形态：把答案写成该 toolCall 的 toolResult（pi 自己的 live 路径就是这么存的），
// 既持久化答案、又让「已作答」判定成立，且不留悬空 toolCall。
import test from "node:test";
import assert from "node:assert/strict";
import { AgentSessionWrapper } from "../lib/rpc-manager";

type Captured = Record<string, unknown>;

function makeWrapper() {
  const appended: Captured[] = [];
  const inner = {
    sessionId: "s1",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    sessionManager: {
      appendMessage: (msg: Captured) => {
        appended.push(msg);
        return "entry-1";
      },
    },
  };
  return { wrapper: new AgentSessionWrapper(inner as never), appended };
}

const recovered = {
  toolCallId: "tc-question-1",
  request: {
    method: "select" as const,
    title: "要继续吗？",
    question: "要继续吗？",
    options: ["继续", "停止"],
  },
};

test("作答后落盘的是该 toolCall 的 toolResult，而不是一条 user 消息", async () => {
  const { wrapper, appended } = makeWrapper();
  try {
    wrapper.rehydrateUnansweredQuestion(recovered);

    await wrapper.send({ type: "extension_ui_response", id: "rehydrate:tc-question-1", value: "继续" });

    assert.equal(appended.length, 1);
    const msg = appended[0];
    assert.equal(msg.role, "toolResult");
    assert.equal(msg.toolCallId, "tc-question-1");
    assert.equal(msg.toolName, "question");
    assert.equal(msg.isError, false);
    const text = (msg.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    assert.match(text, /继续/);
  } finally {
    // destroy() 必须无条件执行：断言失败时若跳过，idle 定时器会挂住测试进程。
    wrapper.destroy();
  }
});

test("取消作答不落任何消息（下次打开仍可恢复）", async () => {
  const { wrapper, appended } = makeWrapper();
  try {
    wrapper.rehydrateUnansweredQuestion(recovered);

    await wrapper.send({ type: "extension_ui_response", id: "rehydrate:tc-question-1", cancelled: true } as never);

    assert.equal(appended.length, 0);
  } finally {
    wrapper.destroy();
  }
});

test("multiple 多问：答案逐问写进同一个 toolResult 文本", async () => {
  const { wrapper, appended } = makeWrapper();
  try {
    wrapper.rehydrateUnansweredQuestion({
      toolCallId: "tc-multi-1",
      request: {
        method: "multiple",
        title: "请回答以下 2 个问题",
        questions: [
          { title: "Q1", question: "Q1", options: ["A", "B"] },
          { title: "Q2", question: "Q2", options: ["C", "D"] },
        ],
      },
    });

    await wrapper.send({
      type: "extension_ui_response",
      id: "rehydrate:tc-multi-1",
      value: ["A", "D"],
    });

    assert.equal(appended.length, 1);
    const msg = appended[0];
    assert.equal(msg.role, "toolResult");
    const text = (msg.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    assert.match(text, /Q1\s*->\s*A/);
    assert.match(text, /Q2\s*->\s*D/);
  } finally {
    wrapper.destroy();
  }
});
