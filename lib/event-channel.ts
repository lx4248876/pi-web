// 事件通道策略（来自多会话 question 弹窗偶发不触发的定位）：
//  前端只有建立 EventSource 才能收到 agent 的 extension_ui_request（最简单入口）。
//  原实现用「当时是否 running/isStreaming」的快照当门槛，导致一个已挂载会话在
//  挂载瞬间该快照为 false 时不建通道，而重开通道的唯一机会又是用户亲手发消息——
//  它在多会话并发切换/外部续跑时发出 question，会被服务端缓存却永无监听器重放，
//  弹窗不触发。
//
// 规则：只要挂载了真实会话（非只读子代理）就无条件建通道，不依赖任何一次性快照。
// 服务端对「无监听器时收到 dialog 请求」有缓冲重放，SSE 一建上会自动补投；为
// 空闲会话开一条仅收心跳的空通道代价可忽略。

// 重连判断：SSE 掉线时，只要当前 EventSource 仍是本会话的当前连接，就应重连。
// 原实现用 agentRunningRef（是否"正在运行"）当门槛，导致掉线瞬间若未标记运行则
// 永不重连、通道永久死亡，之后的 question 全部收不到。用指数退避控制频率即可。
export function shouldReconnect(isCurrentConnection: boolean): boolean {
    return isCurrentConnection;
}