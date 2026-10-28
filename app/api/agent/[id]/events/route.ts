import { isChildSessionPath, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { SseWriter } from "@/lib/sse-writer";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 子代理子会话为只读，不为其建立交互事件通道（交互用 /api/subagents/[id]/events）。
  // 放 fast path 之前：即使子会话 wrapper 意外泄漏进注册表也不被附加。
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return new Response("Session not found", { status: 404 });
  }
  if (isChildSessionPath(filePath)) {
    return new Response("Read-only subagent session", { status: 403 });
  }

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      // SseWriter 吞掉「controller 已关闭」的 enqueue 异常并闩住 closed：
      // 这个回调会在 wrapper.emit()（pi SDK 同步事件分发）里被执行，抛出去会
      // 打断同一次 emit 的其余监听器。
      const writer = new SseWriter(controller);

      const unsubscribe = session.onEvent((event) => {
        writer.send(event);
      });

      writer.send({ type: "connected", sessionId: id });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        writer.sendHeartbeat();
      }, 30_000);

      // Cleanup is idempotent: abort can fire after the stream was closed, and
      // the heartbeat timer must never outlive the connection.
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        unsubscribe();
        writer.close();
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
