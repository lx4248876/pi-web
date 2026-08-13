import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  // 0.81.1：AuthStorage 已移除，OAuth 能力经 Provider.auth.oauth 判定，登出走 runtime.logout
  const runtime = await ModelRuntime.create();
  const target = runtime.getProvider(provider);
  if (!target?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await runtime.logout(provider);
  return Response.json({ ok: true });
}
