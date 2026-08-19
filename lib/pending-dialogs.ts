// 未答弹窗队列的纯函数逻辑（可单测、无 React 依赖）。
//
// 为什么需要队列：`extension_ui_request` 弹窗是单槽位时，第二个 question（多会话
// 并发、或服务端缓冲重放）的请求会无脑覆盖第一个还没答的弹窗，让它在用户做选择
// 前就从界面上消失。改成「按 id 入队、作答才移除」后，未答弹窗永远不被新请求顶掉。
//
//   ponytail: 纯 append/去重/按 id 移除即可满足「除非我选了否则不消失」；若将来要
//   乱序作答或并发面板，再升级为真正的队列容器。

export interface PendingDialog {
	id: string;
}

/** 追加一个未答弹窗；同 id 去重（防止缓冲重放叠出重复卡）。返回新数组，不修改入参。 */
export function pushPendingDialog<T extends PendingDialog>(queue: T[], request: T): T[] {
	if (queue.some((q) => q.id === request.id)) return queue;
	return [...queue, request];
}

/** 用户对某 id 作答/取消后，从队列移除该弹窗。返回新数组，不修改入参。 */
export function removePendingDialog<T extends PendingDialog>(queue: T[], id: string): T[] {
	return queue.filter((q) => q.id !== id);
}