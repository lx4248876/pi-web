// Server-side implementation of POST /api/git-status.
//
// Lives here (instead of inline in the route) for two reasons:
//  1. every action must call git through `execFile`-style argument arrays — never
//     a shell string. The previous `execSync(\`git checkout ${branchName}\`)`
//     turned any quoted branch name / commit message / file path into command
//     execution (cmd.exe does not treat `\"` as an escape);
//  2. the path/ref validation has to be unit-testable with real git repos.
//
// All user-supplied paths are validated against the repository root (writes) or
// the repository root plus explicitly allowed read roots (diffs).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertInsideRoot, isInsideRoot, PathEscapeError } from "./path-guard";

export interface GitActionOptions {
  /**
   * Extra directories a *read* (diff) may touch, e.g. the pi agent dir where
   * session artifacts live. Writes are always confined to the repo cwd.
   */
  extraReadRoots?: string[];
}

export interface GitActionResult {
  status: number;
  json: Record<string, unknown>;
}

/** Bad user input -> HTTP 400 (as opposed to a git failure -> HTTP 500). */
class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

const REF_RE = /^[A-Za-z0-9._/-]+$/;
const SHA_RE = /^[0-9a-fA-F]{4,40}$/;

function ok(json: Record<string, unknown>): GitActionResult {
  return { status: 200, json };
}

function fail(status: number, error: string, details?: unknown): GitActionResult {
  return { status, json: details === undefined ? { error } : { error, details } };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** git <args...> in `cwd`, no shell, stdout as utf8 string. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }) as string;
}

/** A branch / commit shorthand that git will not mistake for an option. */
function assertRef(value: string | undefined, label: string): string {
  if (!value) throw new InputError(`${label} is required`);
  if (!REF_RE.test(value) || value.startsWith("-") || value.includes("..")) {
    throw new InputError(`Invalid ${label}: ${value}`);
  }
  return value;
}

function assertSha(value: string | undefined, label: string): string {
  if (!value) throw new InputError(`${label} is required`);
  if (!SHA_RE.test(value)) throw new InputError(`Invalid ${label}: ${value}`);
  return value;
}

/** Repository-relative path (may contain spaces/unicode) that must stay in cwd. */
function assertRepoPath(cwd: string, value: string | undefined, label: string): string {
  if (!value) throw new InputError(`${label} is required`);
  return assertInsideRoot(cwd, path.resolve(cwd, value), label);
}

/** Write target: must stay inside the repository root. */
function resolveWritePath(cwd: string, value: string | undefined): string {
  if (!value) throw new InputError("filePath is required");
  const absolute = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return assertInsideRoot(cwd, absolute, "filePath");
}

/** Read target: repository root or one of the extra read roots. */
function resolveReadPath(
  cwd: string,
  value: string,
  options: GitActionOptions,
): { absolute: string; repoRelative: string | null } {
  const expanded =
    value === "~" || value.startsWith("~/") || value.startsWith("~" + path.sep)
      ? path.join(os.homedir(), value.slice(1))
      : value;
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);

  if (isInsideRoot(cwd, absolute)) {
    return {
      absolute,
      repoRelative: path.relative(cwd, absolute).replace(/\\/g, "/"),
    };
  }
  for (const root of options.extraReadRoots ?? []) {
    if (root && isInsideRoot(root, absolute)) return { absolute, repoRelative: null };
  }
  throw new InputError(`filePath is outside the allowed roots: ${value}`);
}

function parseStatusLine(line: string): { status: string; file: string; isConflict: boolean } {
  // git status -s prints exactly 2 characters for status, a space, then the
  // filepath. Do NOT trim before slicing: " M package.json" has one leading
  // space and trimming would shift the offsets.
  const statusType = line.slice(0, 2);
  const file = line.slice(3).trim().replace(/^"|"$/g, "");
  const isConflict =
    statusType === "UU" || statusType === "AA" || statusType === "UD" || statusType === "DU";
  return { status: statusType, file, isConflict };
}

/**
 * Run one git-panel action. Never throws for user input problems; returns the
 * HTTP status + JSON body the route should send.
 */
export function runGitAction(
  body: Record<string, unknown>,
  options: GitActionOptions = {},
): GitActionResult {
  const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
  const action = typeof body.action === "string" ? body.action : undefined;

  if (!cwd || !existsSync(cwd)) return fail(400, "Invalid project path/CWD");

  try {
    switch (action) {
      case "status":
        return gitStatus(cwd);
      case "list-branches":
        return listBranches(cwd);
      case "checkout":
        return checkout(cwd, body.branchName as string | undefined);
      case "merge":
        return merge(cwd, body.targetBranch as string | undefined);
      case "commit":
        return commit(cwd, body.commitMessage as string | undefined);
      case "rollback":
        return rollback(cwd, body.rollbackFiles as string[] | undefined);
      case "push":
        return push(cwd, body.forcePush === true);
      case "pull":
        return pull(cwd);
      case "fetch":
        return fetchAll(cwd);
      case "resolve-conflict":
        return resolveConflict(
          cwd,
          body.filePath as string | undefined,
          body.resolveConflictMode as "mine" | "theirs" | undefined,
        );
      case "diff":
        return diff(cwd, body as DiffBody, options);
      case "commit-files":
        return commitFiles(cwd, body.branchName as string | undefined);
      case "delete-branch":
        return deleteBranch(cwd, body.branchName as string | undefined);
      case "create-branch":
        return createBranch(cwd, body.branchName as string | undefined);
      case "write-file":
        return writeFile(cwd, body.filePath as string | undefined, body.content as string | undefined);
      default:
        return fail(400, "Unsupported action");
    }
  } catch (err) {
    if (err instanceof InputError || err instanceof PathEscapeError) {
      return fail(400, errorMessage(err));
    }
    return fail(500, "Git command failed", errorMessage(err));
  }
}

function gitStatus(cwd: string): GitActionResult {
  try {
    const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();

    let ahead = 0;
    let behind = 0;
    try {
      const parts = git(cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]).trim().split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10);
        ahead = parseInt(parts[1], 10);
      }
    } catch {
      // No upstream / no remote tracking configured.
    }

    const isMerging = existsSync(`${cwd}${path.sep}.git${path.sep}MERGE_HEAD`);

    const modifiedFiles = git(cwd, ["-c", "core.quotePath=false", "status", "-s"])
      .split("\n")
      .filter(Boolean)
      .map(parseStatusLine);

    const history = git(cwd, ["-c", "core.quotePath=false", "log", "--oneline", "-n", "30"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ hash: line.slice(0, 7), message: line.slice(8) }));

    return ok({
      branch,
      ahead,
      behind,
      modifiedFiles,
      history,
      isMerging,
      isClean: modifiedFiles.length === 0,
    });
  } catch (err) {
    return ok({
      error: "Not a git repository or git missing",
      details: errorMessage(err),
    });
  }
}

function listBranches(cwd: string): GitActionResult {
  try {
    const local = git(cwd, ["branch", "--format=%(refname:short)"])
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
    const remote = git(cwd, ["branch", "-r", "--format=%(refname:short)"])
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .filter((b) => !b.includes("/HEAD") && b.includes("/"));
    return ok({ local, remote });
  } catch (err) {
    return fail(500, "Failed to load branches", errorMessage(err));
  }
}

function checkout(cwd: string, branchName: string | undefined): GitActionResult {
  const ref = assertRef(branchName, "branchName");
  try {
    return ok({ success: true, message: git(cwd, ["checkout", ref]).trim() });
  } catch (err) {
    return fail(500, "Checkout failed. Make sure your working tree is clean.", errorMessage(err));
  }
}

function merge(cwd: string, targetBranch: string | undefined): GitActionResult {
  const ref = assertRef(targetBranch, "targetBranch");
  try {
    return ok({ success: true, message: git(cwd, ["merge", ref]).trim() });
  } catch (err) {
    const message = errorMessage(err);
    if (message.toLowerCase().includes("conflict") || message.toLowerCase().includes("failed")) {
      return {
        status: 200,
        json: {
          error: "Merge conflict occurred! Please resolve conflicts inside the files.",
          conflicted: true,
          details: message,
        },
      };
    }
    return fail(500, "Merge failed", message);
  }
}

function commit(cwd: string, commitMessage: string | undefined): GitActionResult {
  const message = (commitMessage ?? "").trim();
  if (!message) throw new InputError("Commit message is required");
  git(cwd, ["add", "-A"]);
  return ok({ success: true, message: git(cwd, ["commit", "-m", message]).trim() });
}

function rollback(cwd: string, rollbackFiles: string[] | undefined): GitActionResult {
  if (!Array.isArray(rollbackFiles) || rollbackFiles.length === 0) {
    throw new InputError("Provide at least one file to revert");
  }
  for (const file of rollbackFiles) {
    assertRepoPath(cwd, file, "rollbackFiles");
    git(cwd, ["checkout", "HEAD", "--", file]);
    try {
      git(cwd, ["reset", "HEAD", "--", file]);
    } catch {
      // Best effort: files that were never staged have nothing to reset.
    }
  }
  return ok({ success: true });
}

function push(cwd: string, force: boolean): GitActionResult {
  const args = force ? ["push", "-f"] : ["push"];
  try {
    return ok({ success: true, message: git(cwd, args).trim() });
  } catch (err) {
    return fail(500, "Push failed", errorMessage(err));
  }
}

function pull(cwd: string): GitActionResult {
  try {
    return ok({ success: true, message: git(cwd, ["pull"]).trim() });
  } catch (err) {
    const message = errorMessage(err);
    if (message.toLowerCase().includes("conflict")) {
      return {
        status: 200,
        json: { error: "Pull conflicts occurred! Please resolve conflicts.", conflicted: true },
      };
    }
    return fail(500, "Pull failed", message);
  }
}

function fetchAll(cwd: string): GitActionResult {
  try {
    return ok({ success: true, message: git(cwd, ["fetch"]).trim() });
  } catch (err) {
    return fail(500, "Fetch failed", errorMessage(err));
  }
}

function resolveConflict(
  cwd: string,
  filePath: string | undefined,
  mode: "mine" | "theirs" | undefined,
): GitActionResult {
  if (!filePath || !mode) throw new InputError("filePath and resolveConflictMode required");
  assertRepoPath(cwd, filePath, "filePath");
  const sideFlag = mode === "mine" ? "--ours" : "--theirs";
  git(cwd, ["checkout", sideFlag, "--", filePath]);
  git(cwd, ["add", filePath]);
  return ok({ success: true });
}

interface DiffBody {
  filePath?: string;
  commitHash?: string;
}

const BINARY_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".wav"];

function diff(cwd: string, body: DiffBody, options: GitActionOptions): GitActionResult {
  if (!body.filePath) throw new InputError("filePath required");

  const { absolute, repoRelative } = resolveReadPath(cwd, body.filePath, options);
  const displayPath = repoRelative ?? absolute;

  if (BINARY_EXT.some((ext) => displayPath.toLowerCase().endsWith(ext))) {
    return ok({
      oldContent: "二进制文件无法预览 Diff\n(Binary file changes cannot be compared textually)",
      newContent: "二进制文件无法预览 Diff\n(Binary file)",
      filePath: displayPath,
    });
  }

  let oldContent = "";
  let newContent = "";
  let fileExists = false;

  if (body.commitHash) {
    const sha = assertSha(body.commitHash, "commitHash");
    if (repoRelative) {
      try {
        oldContent = git(cwd, ["-c", "core.quotePath=false", "show", `${sha}~1:${repoRelative}`]);
      } catch {
        // First commit: no parent state.
      }
      try {
        newContent = git(cwd, ["-c", "core.quotePath=false", "show", `${sha}:${repoRelative}`]);
        fileExists = true;
      } catch {
        // File did not exist at that commit.
      }
    }
  } else {
    if (repoRelative) {
      try {
        oldContent = git(cwd, ["-c", "core.quotePath=false", "show", `HEAD:${repoRelative}`]);
      } catch {
        // New file: no HEAD version.
      }
    }
    try {
      newContent = readFileSync(absolute, "utf8");
      fileExists = true;
    } catch {
      // Deleted/renamed: leave fileExists false so the UI can say so.
    }
  }

  return ok({ oldContent, newContent, filePath: displayPath, exists: fileExists });
}

function commitFiles(cwd: string, hash: string | undefined): GitActionResult {
  const sha = assertSha(hash, "branchName");
  try {
    const out = git(cwd, ["-c", "core.quotePath=false", "show", "--name-status", "--oneline", sha]);
    const lines = out.split("\n").filter(Boolean);
    const files = lines.slice(1).map((line) => {
      const parts = line.split(/\s+/);
      return { status: parts[0], file: parts.slice(1).join(" ") };
    });
    return ok({ files });
  } catch (err) {
    return fail(500, "Failed to load files for this commit", errorMessage(err));
  }
}

function deleteBranch(cwd: string, branchName: string | undefined): GitActionResult {
  const ref = assertRef(branchName, "branchName");
  try {
    return ok({ success: true, message: git(cwd, ["branch", "-D", ref]).trim() });
  } catch (err) {
    return fail(500, "Delete branch failed", errorMessage(err));
  }
}

function createBranch(cwd: string, branchName: string | undefined): GitActionResult {
  const ref = assertRef(branchName, "branchName");
  try {
    return ok({ success: true, message: git(cwd, ["checkout", "-b", ref]).trim() });
  } catch (err) {
    return fail(500, "Create branch failed", errorMessage(err));
  }
}

function writeFile(
  cwd: string,
  filePath: string | undefined,
  content: string | undefined,
): GitActionResult {
  if (content === undefined) throw new InputError("filePath and content required");
  const absolute = resolveWritePath(cwd, filePath);
  try {
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
    return ok({ success: true });
  } catch (err) {
    return fail(500, "Write failed", errorMessage(err));
  }
}
