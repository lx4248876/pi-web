import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * True when `candidate` is `root` itself or lives underneath it.
 *
 * Compares *resolved* paths, so `root/../escape` and `root-evil` (a sibling
 * whose name merely starts with the root) are both rejected. `path.relative`
 * is case-insensitive on win32 by design, which is what we want here.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "") return true;
  if (rel === "..") return false;
  if (isAbsolute(rel)) return false; // different drive on win32
  return !rel.startsWith(`..${sep}`) && !rel.startsWith("../");
}

/**
 * Throws unless `candidate` is inside `root`. Returns the resolved path so
 * callers do not accidentally use the raw, un-normalized input.
 */
export function assertInsideRoot(
  root: string,
  candidate: string,
  what = "path",
): string {
  if (!isInsideRoot(root, candidate)) {
    throw new PathEscapeError(`${what} escapes the allowed root: ${candidate}`);
  }
  return resolve(candidate);
}

/** Raised for "user asked for something outside the allowed root" (-> HTTP 400). */
export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}
