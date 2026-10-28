import { realpathSync } from "node:fs";

/**
 * Resolve a path to its canonical form (symlinks resolved). Returns null when
 * the path does not exist — an allow-list check must never pass for a file we
 * could not canonicalize.
 */
function canonical(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  // win32 paths are case-insensitive; comparing canonical lowercase forms keeps
  // `C:\SKILLS\X\SKILL.md` and `C:\skills\x\SKILL.md` equal without weakening
  // the allow-list (both were already canonicalized).
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * Return the entry of `allowedFilePaths` that the request actually points at,
 * or null.
 *
 * `PATCH /api/skills` must only ever rewrite a SKILL.md that the caller could
 * see in the loaded skill list; accepting a client-supplied absolute path made
 * it an arbitrary-file-write primitive (~/.pi/agent/settings.json, shell rc
 * files, ...). Canonicalizing both sides also defeats `..` and symlink tricks.
 */
export function findAllowedSkillFile(
  filePath: string,
  allowedFilePaths: readonly string[],
): string | null {
  if (!filePath) return null;
  const target = canonical(filePath);
  if (!target) return null;

  for (const allowed of allowedFilePaths) {
    if (!allowed) continue;
    const canonicalAllowed = canonical(allowed);
    if (!canonicalAllowed) continue;
    if (samePath(canonicalAllowed, target)) return allowed;
  }
  return null;
}
