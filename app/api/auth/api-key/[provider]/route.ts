import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  // 0.81.1：AuthStorage/ModelRegistry.create 已移除，改走 ModelRuntime
  const runtime = await ModelRuntime.create();
  const registry = new ModelRegistry(runtime);
  const status = registry.getProviderAuthStatus(provider);
  const displayName = registry.getProviderDisplayName(provider);
  const models = registry.getAll().filter((m) => m.provider === provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    // 0.81.1：持久化凭证改走 runtime.login；内置 apiKey 流程只会 prompt 一次索要 key
    const runtime = await ModelRuntime.create();
    await runtime.login(provider, "api_key", {
      prompt: async () => apiKey.trim(),
      notify: () => {},
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    // 0.81.1：删除凭证改走 runtime.logout（等价旧的 authStorage.remove）
    const runtime = await ModelRuntime.create();
    await runtime.logout(provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
