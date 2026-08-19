import { NextResponse } from "next/server";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  getCachedZhDescription,
  setCachedZhDescription,
  fetchNpmInfo,
} from "@/lib/pi-packages";

export const dynamic = "force-dynamic";

// Resolve the environment's configured default provider/model (settings.json).
function readDefaultModel(): { provider?: string; model?: string } {
  try {
    const settings = JSON.parse(
      readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8"),
    ) as { defaultProvider?: string; defaultModel?: string };
    return { provider: settings.defaultProvider, model: settings.defaultModel };
  } catch {
    return {};
  }
}

// Strip common non-informative README cruft (badges, image lines) so the model
// spends tokens translating actual content, and the result stays readable.
function cleanReadme(readme: string): string {
  return readme
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^\[!\[/.test(l)) return false; // CI/npm/version shields
      if (/^!\[/.test(l)) return false; // images
      if (/^<img\b/.test(l) || /^<p.*>.*<\/p>$/i.test(l) && /<img/i.test(l)) return false;
      if (/<!--/.test(l)) return false; // HTML comments
      return true;
    })
    .join("\n")
    .trim()
    .slice(0, 8000); // safety cap
}

// GET /api/packages/translate-desc?name=<pkg>
// Returns the cached Chinese translation, or { zh: null } when not yet translated.
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const zh = getCachedZhDescription(name);
  return NextResponse.json({ name, zh, cached: !!zh });
}

// POST /api/packages/translate-desc
// body: { name: string, description?: string }
// Translates a package's English content to Chinese. Prefers the full npm
// README (richest info: overview, features, install, usage); falls back to the
// short description. The result is cached on disk (~/.pi/agent/packages-desc-
// cache.json), keyed by package name, so a later GET returns it instantly.
export async function POST(req: Request) {
  let name: string;
  let description = "";
  try {
    const body = await req.json() as { name?: string; description?: string };
    name = (body.name ?? "").trim();
    description = (body.description ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // 1) cache hit — return immediately, no model call
  const cached = getCachedZhDescription(name);
  if (cached) return NextResponse.json({ name, zh: cached, cached: true });

  // 2) fetch the richest English source
  let sourceText = description;
  let useReadme = false;
  if (!sourceText) {
    const info = await fetchNpmInfo(name);
    if (info.readme) {
      sourceText = cleanReadme(info.readme);
      useReadme = true;
    } else if (info.description) {
      sourceText = info.description;
    }
  }
  if (!sourceText) {
    return NextResponse.json({ error: "No English content available to translate" }, { status: 422 });
  }

  try {
    const runtime = await ModelRuntime.create();
    const registry = new ModelRegistry(runtime);

    const { provider, model } = readDefaultModel();
    const pick =
      (provider && model && registry.find(provider, model)) ||
      registry.getAvailable()[0];

    if (!pick) {
      return NextResponse.json({ error: "No model available for translation" }, { status: 404 });
    }

    const authResult = await registry.getApiKeyAndHeaders(pick);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    const systemPrompt = useReadme
      ? "You are a precise technical translator specializing in developer tools. Translate the given English npm/pi README into accurate, natural Simplified Chinese. Keep technical terms, package names, CLI commands, code snippets, and API names in English as-is. Format with Markdown headings and bullet lists where the source uses them. Output ONLY the Chinese translation."
      : "You are a precise technical translator. Translate the given English plugin description into concise, natural Simplified Chinese. Keep technical terms (package names, protocols, model names, API names) untranslated. Output ONLY the Chinese translation, no quotes, no commentary.";

    // Longer content needs more output tokens (README can be a few thousand chars).
    const maxTokens = useReadme ? 4000 : 400;

    const context: Context = {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: sourceText,
          timestamp: Date.now(),
        },
      ],
    };

    const options = {
      apiKey: authResult.apiKey,
      headers: authResult.headers,
      maxTokens,
      timeoutMs: useReadme ? 90_000 : 30_000,
    };

    let zh = "";
    const stream = runtime.stream(pick, context, options);
    for await (const event of stream) {
      if (event.type === "text_delta") {
        zh += (event as { type: "text_delta"; delta: string }).delta;
      }
      if (event.type === "error") {
        return NextResponse.json({ error: "Model stream error during translation" }, { status: 502 });
      }
    }

    zh = zh.trim();
    if (!zh) return NextResponse.json({ error: "Empty translation returned" }, { status: 502 });

    setCachedZhDescription(name, zh, {
      en: sourceText.slice(0, 2000),
      source: useReadme ? "readme" : "desc",
    });
    return NextResponse.json({ name, zh, cached: false, source: useReadme ? "readme" : "desc" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}