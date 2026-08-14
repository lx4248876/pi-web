import { ModelRegistry, ModelRuntime, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const nameMap = new Map<string, string>();
  let modelList: {
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
    api?: string;
  }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  try {
    const agentDir = getAgentDir();
    // 0.81.1：AuthStorage/ModelRegistry.create 已移除，改走 ModelRuntime
    const runtime = await ModelRuntime.create();
    const registry = new ModelRegistry(runtime);
    const available = registry.getAvailable();
    modelList = available.map(
      (m: {
        id: string;
        name: string;
        provider: string;
        contextWindow?: number;
        api?: string;
      }) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        contextWindow: m.contextWindow,
        api: m.api,
      }),
    );
    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const settings = SettingsManager.create(process.cwd(), agentDir);
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider) {
      defaultModel = { provider, modelId: modelId ?? available[0]?.id ?? "" };
    }
  } catch { /* return empty */ }

  return Response.json({ models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, thinkingLevelMaps });
}
