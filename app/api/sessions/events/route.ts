import { onRpcSessionEvent } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/sessions/events - SSE stream of session-list change notifications.
// 活跃会话开始/结束运行时推送一条轻量通知，前端据此静默刷新会话列表，
// 让状态点（转圈/绿/红）即时更新，替代轮询。
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      encode({ type: "connected" });

      const unsubscribe = onRpcSessionEvent((sessionId) => {
        encode({ type: "session_activity", sessionId });
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
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
