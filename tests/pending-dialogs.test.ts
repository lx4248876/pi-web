import test from "node:test";
import assert from "node:assert/strict";
import { pushPendingDialog, removePendingDialog } from "../lib/pending-dialogs";

// 复现方向：弹窗是单槽位时，第二个 question 会把未答的第一个整个顶掉（消失）。
// 新逻辑：未答弹窗按 id 入队保留，新请求永远不覆盖旧的；只有对某 id 作答后才移除。
test("a second dialog request does not drop an unanswered first one", () => {
	const first = { id: "q1" };
	const second = { id: "q2" };
	let queue = pushPendingDialog([], first);
	queue = pushPendingDialog(queue, second);
	assert.deepEqual(queue.map((q) => q.id), ["q1", "q2"]);
});

test("buffered replays of the same request id are de-duplicated", () => {
	const req = { id: "q1" };
	let queue = pushPendingDialog([], req);
	queue = pushPendingDialog(queue, { ...req, id: "q1" });
	assert.deepEqual(queue.map((q) => q.id), ["q1"]);
});

test("answering one id removes only that dialog, keeping others", () => {
	const queue = pushPendingDialog(
		pushPendingDialog([], { id: "q1" }),
		{ id: "q2" },
	);
	const after = removePendingDialog(queue, "q1");
	assert.deepEqual(after.map((q) => q.id), ["q2"]);
});

test("removing an unknown id is a no-op", () => {
	const queue = [{ id: "q1" }];
	assert.deepEqual(removePendingDialog(queue, "nope"), queue);
});