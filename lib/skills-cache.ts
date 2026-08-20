import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SkillsData {
  skills: unknown[];
  diagnostics: unknown[];
}

/**
 * Listing skills rescans every skill directory and reads each SKILL.md
 * frontmatter (~1s), so it must not run on every `/` menu open. We cache the
 * scan per-cwd for a short TTL and deduplicate concurrent loads into a single
 * in-flight promise. Explicit mutations (install / toggle) call clearSkillsCache.
 */
const cache = new Map<string, { ts: number; value: SkillsData }>();
const TTL = 20_000;
// In-flight scan per cwd, so concurrent loads for different cwd never reuse
// the wrong scan (a single shared promise would cross-session-pollute skills).
const pending = new Map<string, Promise<SkillsData>>();

export function clearSkillsCache() {
  cache.clear();
}

export async function loadSkillsCached(cwd: string): Promise<SkillsData> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.ts < TTL) return hit.value;

  let promise = pending.get(cwd);
  if (!promise) {
    promise = (async () => {
      try {
        const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
        await loader.reload();
        return loader.getSkills() as SkillsData;
      } finally {
        pending.delete(cwd);
      }
    })();
    pending.set(cwd, promise);
  }
  const value = await promise;
  cache.set(cwd, { ts: Date.now(), value });
  return value;
}