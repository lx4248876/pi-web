import { runPi } from "./pi-exec";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface PiPackage {
  name: string;
  description: string;
  types: string[];
  downloads: number;
  date: number; // epoch ms
  sortName: string;
  searchText: string;
  install: string; // e.g. "npm:@hypabolic/pi-hypa"
  npmUrl?: string;
  repoUrl?: string;
  previewStatus?: string;
}

const PI_PACKAGES_BASE = process.env.PI_PACKAGES_URL || "https://pi.dev/packages";

// Single-window TTL cache keyed by the request path (name/type/page).
const cache = new Map<string, { at: number; out: { packages: PiPackage[]; totalPages: number | null } }>();
const TTL_MS = 60_000;

function parseDownloads(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// Extract `<p class="packages-desc">…</p>`:
function extractDescription(block: string, searchText: string): string {
  const m = block.match(/packages-desc">([\s\S]*?)<\/p>/);
  const fromDesc = m && typeof m[1] === "string" ? decodeEntities(m[1]) : "";
  if (fromDesc) return fromDesc;
  return decodeEntities(searchText.split(" ").slice(1).join(" "));
}

function parseInstallCommand(block: string): string {
  // inside: "$ pi install npm:x" or "$ pi install git:y"
  const m = block.match(/pi\s+install\s+((?:npm|git):[^\s<"&]+)/);
  return m ? m[1] : "";
}

/**
 * Extract the last page number from the pi.dev pagination footer, e.g.
 * "… 109" => 109. Returns null when the page has no pagination (single page).
 */
function parseTotalPages(html: string): number | null {
  // pagination links look like: <a class="pagination-page" href="/packages?page=N">N</a>
  const pages: number[] = [];
  const re = /href="\/packages\?page=(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) pages.push(n);
  }
  if (pages.length === 0) return null;
  return Math.max(...pages);
}

/**
 * Fetch one page of pi.dev/packages and extract package cards.
 * pi.dev supports server-side filters via `?name=` and `?type=`.
 * Returns the packages plus an optional total page count for the current query.
 */
export async function fetchPiPackages(opts: {
  name?: string;
  type?: string;
  page?: number;
} = {}): Promise<{ packages: PiPackage[]; totalPages: number | null }> {
  const { name, type, page } = opts;
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (type) params.set("type", type);
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  const key = qs || "";

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.out;

  const url = qs ? `${PI_PACKAGES_BASE}?${qs}` : PI_PACKAGES_BASE;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`pi.dev responded ${res.status}: ${res.statusText}`);
  const html = await res.text();

  const packages: PiPackage[] = [];
  // Each card is an <article class="surface-panel content-card"> block.
  const cardRe = /<article class="surface-panel content-card"([\s\S]*?)<\/article>/g;
  let match: RegExpExecArray | null;
  while ((match = cardRe.exec(html)) !== null) {
    const block = match[1];
    const attr = (name_: string): string | undefined => {
      const m = block.match(new RegExp(`${name_}\\s*=\\"([^"]*)\\"`));
      return m ? m[1] : undefined;
    };
    const name_ = attr("data-package-name");
    if (!name_) continue;

    const pkg: PiPackage = {
      name: name_,
      description: extractDescription(block, attr("data-package-search") || ""),
      types: (attr("data-package-types") || "")
        .split(/\s+/)
        .filter(Boolean),
      downloads: parseDownloads(attr("data-package-downloads")),
      date: Number(attr("data-package-date")) || 0,
      sortName: attr("data-package-sort-name") || name_,
      searchText: attr("data-package-search") || "",
      install: parseInstallCommand(block),
      npmUrl: block.match(/href="(https:\/\/www\.npmjs\.com\/package\/[^"]+)"/)?.[1],
      repoUrl: block.match(/href="(https:\/\/github\.com\/[^"]+)"/)?.[1],
      previewStatus: attr("data-package-preview-status"),
    };
    packages.push(pkg);
  }

  cache.set(key, { at: Date.now(), out: { packages, totalPages: parseTotalPages(html) } });
  return { packages, totalPages: parseTotalPages(html) };
}

export interface InstalledPackage {
  // raw source as pi reports it, e.g. "npm:pi-subagents", a git: or a bare path
  source: string;
  // normalized package name for matching against the marketplace:
  // for npm: sources this is the bare package name
  name?: string;
}

/**
 * List installed pi packages via `pi list`. Returns the parsed set so the UI
 * can tag marketplace packages as already installed.
 */
export async function listInstalledPackages(): Promise<InstalledPackage[]> {
  const { stdout } = await runPi(["list"], { timeout: 20_000 });
  const out: InstalledPackage[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // skip section headers
    if (t.startsWith("User packages:") || t.startsWith("Project packages:")) continue;

    // npm: / git: sources come without leading indentation and appear at line start.
    // Scoped npm names (@scope/name) contain '/', so check the scheme first.
    let name: string | undefined;
    const npmM = t.match(/^npm:(.+)/);
    if (npmM) {
      name = npmM[1].trim();
      out.push({ source: t, name });
      continue;
    }
    const gitM = t.match(/^git:.*/);
    if (gitM) {
      out.push({ source: t, name: t });
      continue;
    }

    // Remaining entries are filesystem paths (indented under their source line,
    // or bare local path sources). Skip anything path-like.
    if (/^[/\\]|[A-Za-z]:[\\/]|^\.\.?[\\/]/.test(t)) continue;
    if (/[\\/]/.test(t)) continue;

    if (t) out.push({ source: t, name: t });
  }
  return out;
}

/**
 * Remove (uninstall) a pi package. Defaults to global scope; `project` passes -l.
 */
export async function removePiPackage(pkg: string, scope: "global" | "project" = "global"): Promise<string> {
  const source = pkg.includes(":") ? pkg : `npm:${pkg}`;
  const args = scope === "project" ? ["remove", source, "-l"] : ["remove", source];
  const { stdout, stderr } = await runPi(args, { timeout: 60_000 });
  return (stdout + stderr).replace(/\x1B\[[0-9;]*m/g, "");
}

// ── Chinese description cache (仅看详情时翻译 + 本地持久化) ──
// Cache file lives under the pi agent dir so translations persist across web
// reloads and sessions. Each entry stores the English source + Chinese
// translation, so a translated package shows Chinese immediately on next open
// (no repeat model call).
const DESC_CACHE_FILE = join(homedir(), ".pi", "agent", "packages-desc-cache.json");

interface DescCacheEntry {
  zh: string;
  ts: number;
  // English source that was translated. When present and identical to the
  // current source, the cached zh is valid even if the package updated — we can
  // key correctness on the source text itself.
  en?: string;
  // whether this came from the full npm README (true) or just the short desc
  source?: "readme" | "desc";
}

type DescCache = Record<string, DescCacheEntry>;

function loadDescCache(): DescCache {
  try {
    if (existsSync(DESC_CACHE_FILE)) {
      return JSON.parse(readFileSync(DESC_CACHE_FILE, "utf8")) as DescCache;
    }
  } catch {
    // corrupt or unreadable — treat as empty
  }
  return {};
}

function saveDescCache(cacheData: DescCache): void {
  try {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    writeFileSync(DESC_CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf8");
  } catch {
    // non-fatal: cache is best-effort
  }
}

/**
 * Return the cached Chinese translation for a package, if any. Returns null
 * when nothing is cached (caller should then offer the translate button).
 */
export function getCachedZhDescription(name: string): string | null {
  const entry = loadDescCache()[name];
  return entry && entry.zh ? entry.zh : null;
}

/** Persist a freshly-translated Chinese description (optionally with English source + kind). */
export function setCachedZhDescription(
  name: string,
  zh: string,
  opts: { en?: string; source?: "readme" | "desc" } = {},
): void {
  const cacheData = loadDescCache();
  cacheData[name] = {
    zh,
    ts: Date.now(),
    ...(opts.en ? { en: opts.en } : {}),
    ...(opts.source ? { source: opts.source } : {}),
  };
  saveDescCache(cacheData);
}

/**
 * Fetch the full npm README for a package, falling back to the short
 * description from the pi.dev card when the registry has no readme.
 * Returns { readme, description } — readme is null when unavailable.
 */
export async function fetchNpmInfo(name: string): Promise<{ readme: string | null; description: string }> {
  const trimmed = name.trim().replace(/^npm:/, "");
  const desc = "";
  try {
    const enc = trimmed.startsWith("@")
      ? trimmed.replace("/", "%2F")
      : encodeURIComponent(trimmed);
    const res = await fetch(`https://registry.npmjs.org/${enc}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { readme?: string; description?: string };
      const readme = (data.readme ?? "").trim();
      return {
        readme: readme.length > 0 ? readme : null,
        description: (data.description ?? "").trim() || desc,
      };
    }
  } catch {
    // network error — fall back below
  }
  return { readme: null, description: desc };
}