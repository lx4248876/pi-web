// ─── 会话列表变更订阅（供 /api/sessions/events SSE 推送） ─────────────────────
// 活跃会话有「开始跑/跑完」级别的状态变化时通知订阅者；SSE 路由据此推动前端
// 刷新会话列表，替代轮询。注册表挂 globalThis 以免 dev-server 热重载后丢失。

export type RpcSessionEventListener = (sessionId: string, running: boolean) => void;

interface RpcSessionEventRegistry {
  listeners: Set<RpcSessionEventListener>;
}

const g = globalThis as typeof globalThis & { __piSessionEventListeners?: RpcSessionEventRegistry };

function getSessionEventRegistry(): RpcSessionEventRegistry {
  if (!g.__piSessionEventListeners) {
    g.__piSessionEventListeners = { listeners: new Set() };
  }
  return g.__piSessionEventListeners;
}

export function notifyRpcSessionEventListeners(sessionId: string, running: boolean): void {
  for (const l of getSessionEventRegistry().listeners) {
    try {
      l(sessionId, running);
    } catch {
      // 一个订阅者出错不影响其余订阅者
    }
  }
}

export function onRpcSessionEvent(listener: RpcSessionEventListener): () => void {
  const reg = getSessionEventRegistry();
  reg.listeners.add(listener);
  return () => reg.listeners.delete(listener);
}

/**
 * Reload the persisted models.json config into every running session.
 *
 * 模型配置面板保存（/api/models-config PUT）后调用：让所有会话即使正在运行，
 * 也能立刻用上新添加/修改/删除的供应商与模型，无需重启或重开会话。
 * 串行执行（会话数量不多），单个会话失败不影响其余会话；返回统计供调用方提示。
 */
// 与 rpc-manager 共享：listener 由 hot reload 兜底保存在 globalThis
