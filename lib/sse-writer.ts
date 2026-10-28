/**
 * Minimal SSE writer with closed-state tracking.
 *
 * A `ReadableStream` controller throws `TypeError` on `enqueue()` once the
 * stream is closed/aborted. Those throws used to happen inside
 * `AgentSessionWrapper.emit()`'s synchronous loop, i.e. inside a pi SDK
 * subscriber callback, which skips the remaining listeners and can abort the
 * running turn. Every write here is therefore guarded and latches `closed`.
 */

type SseController = {
  enqueue(chunk: Uint8Array): void;
  close?(): void;
};

export function formatSseData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function formatSseHeartbeat(): string {
  return ":\n\n";
}

export interface SseWriterOptions {
  /** Comment frame interval; 0 disables the internal timer (caller drives it). */
  heartbeatMs?: number;
}

export class SseWriter {
  private closed = false;
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly controller: SseController,
    private readonly options: SseWriterOptions = {},
  ) {}

  isClosed(): boolean {
    return this.closed;
  }

  /** Returns false when the client is already gone (no throw). */
  send(data: unknown): boolean {
    return this.write(formatSseData(data));
  }

  /** Returns false when the client is already gone (no throw). */
  sendHeartbeat(): boolean {
    return this.write(formatSseHeartbeat());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close?.();
    } catch {
      // already closed by the runtime
    }
  }

  private write(frame: string): boolean {
    if (this.closed) return false;
    try {
      this.controller.enqueue(this.encoder.encode(frame));
      return true;
    } catch {
      // Controller closed underneath us (client disconnect): latch and stay quiet.
      this.closed = true;
      return false;
    }
  }
}
