import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export async function GET() {
  // 0.81.1：AuthStorage 已移除，OAuth provider 经 Provider.auth.oauth 枚举
  const runtime = await ModelRuntime.create();
  const providers = runtime.getProviders().filter((p) => p.auth.oauth);
  // 已存储凭证的 provider 集合（等价旧的 authStorage.has）
  const stored = new Set((await runtime.listCredentials()).map((c) => c.providerId));

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = providers
    .filter((p) => !EXCLUDED.has(p.id))
    .map((p) => ({
      id: p.id,
      name: DISPLAY_NAMES[p.id] ?? p.auth.oauth?.name ?? p.name,
      // 新交互模型由流程内部处理 callback/manual code 竞速，前端不再区分
      usesCallbackServer: false,
      loggedIn: stored.has(p.id),
    }));

  return Response.json({ providers: result });
}
