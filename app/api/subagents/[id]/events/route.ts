import { resolveSessionPath, getSessionsDir, scanChildSessions } from "@/lib/session-reader";
import { ChildSessionTailer } from "@/lib/subagent-live";
import { cacheSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

// GET /api/subagents/[id]/events - read-only live follow of a subagent child session.
// Tail the child's own .jsonl file and push newly-appended messages. This is a
// *browse-only* channel: it never starts or attaches to an RPC agent, and must
// remain independent of the interactive /api/agent/[id]/events stream.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // The child session file may not be in the (one-level) session cache yet, so do a
  // targeted scan to resolve it if a plain path lookup misses. Still read-only.
  let filePath = await resolveSessionPath(id);
  if (!filePath) {
    try {
      filePath =
        scanChildSessions(getSessionsDir()).find((c) => c.id === id)?.path ?? null;
    } catch {
      filePath = null;
    }
  }
  if (!filePath) {
    return new Response("Subagent session not found", { status: 404 });
  }
  cacheSessionPath(id, filePath);

  const tailer = new ChildSessionTailer(filePath);

  // Push a message entry onto the stream. Encoding is our own, lean protocol:
  // the client interprets child_update / child_terminal / connected.
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      encode({ type: "connected", sessionId: id });

      let lastRunning: boolean | null = null;
      let stopped = false;

      // Poll every 1s; stop polling once the child file reaches a terminal tail and
      // has gone quiet, but keep heartbeats so the HTTP connection stays alive.
      const timer = setInterval(() => {
        if (stopped) return;
        let sample: { messages: unknown[]; running: boolean } | null = null;
        try {
          sample = tailer.poll();
        } catch {
          sample = null;
        }
        if (!sample) {
          encode({ type: "child_error", message: "failed to read subagent session" });
          stopped = true;
          clearInterval(timer);
          return;
        }
        if (sample.messages.length > 0) {
          encode({ type: "child_update", messages: sample.messages, running: sample.running });
        } else if (sample.running !== lastRunning) {
          encode({ type: "child_update", messages: [], running: sample.running });
        }
        lastRunning = sample.running;

        if (!sample.running) {
          // Terminal state reached; stop polling but leave the connection open with
          // the heartbeat so the client sees it as "done" without reconnecting.
          stopped = true;
          clearInterval(timer);
          encode({ type: "child_terminal", running: false });
        }
      }, 1000);

      // Heartbeat every 30s to prevent server/proxy timeout.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(timer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      (_req as Request).signal?.addEventListener("abort", cleanup);
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