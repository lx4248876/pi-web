import test from "node:test";
import assert from "node:assert/strict";
// 用相对路径导入：jiti 不解析 tsconfig 的 @/ 别名
import { shouldReconnect } from "../lib/event-channel";

test("SSE reconnect must depend on the connection being current, not on agentRunning", () => {
    // 当前连接掉线 → 必须重连（不管当时是否标了"正在运行"）
    assert.equal(shouldReconnect(true), true);
    // 非当前连接（已被新连接替换/卸载）→ 不重连
    assert.equal(shouldReconnect(false), false);
});