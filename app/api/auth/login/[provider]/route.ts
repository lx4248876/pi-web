import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // AbortController propagates client disconnect into authStorage.login()
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      // 0.81.1：AuthStorage 已移除，OAuth 登录改走 ModelRuntime.login + AuthInteraction
      const runtime = await ModelRuntime.create();
      const providerInfo = runtime.getProvider(provider);
      if (!providerInfo?.auth.oauth) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        controller.close();
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      // 把旧回调模型映射到 0.81.1 的 AuthInteraction（notify 推事件 / prompt 要输入），
      // 前端 SSE 协议保持不变
      const notify = (event: AuthEvent) => {
        if (event.type === "auth_url") {
          // auth 阶段即创建手动码 token，前端拿到后可直接提交 code（与旧行为一致）
          const request = getManualInputRequest();
          send(controller, {
            type: "auth",
            url: event.url,
            instructions: event.instructions ?? null,
            token: request.token,
          });
        } else if (event.type === "device_code") {
          send(controller, {
            type: "device_code",
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds ?? null,
            expiresInSeconds: event.expiresInSeconds ?? null,
          });
        } else if (event.type === "progress" || event.type === "info") {
          send(controller, { type: "progress", message: event.message });
        }
      };

      const prompt = async (p: AuthPrompt): Promise<string> => {
        if (p.type === "manual_code") {
          // 手动授权码：复用 auth 阶段已下发的 token，等待前端 POST code
          return getManualInputRequest().promise;
        }
        if (p.type === "select") {
          const request = createClientInputRequest();
          send(controller, {
            type: "select_request",
            message: p.message,
            options: p.options,
            token: request.token,
          });
          const value = await request.promise;
          return value;
        }
        // text / secret：通用文本输入
        const request = createClientInputRequest();
        send(controller, {
          type: "prompt_request",
          message: p.message,
          placeholder: p.placeholder ?? null,
          token: request.token,
        });
        return request.promise;
      };

      try {
        await runtime.login(provider, "oauth", { prompt, notify, signal: abort.signal });
        send(controller, { type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled" && !abort.signal.aborted) {
          send(controller, { type: "error", message: msg });
        } else {
          send(controller, { type: "cancelled" });
        }
      } finally {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
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
