import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);

export interface RunPiOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunPiResult {
  stdout: string;
  stderr: string;
}

let cachedPiCli: string | null | undefined;

/**
 * Locate the pi CLI entry (`dist/cli.js`) of the global
 * `@earendil-works/pi-coding-agent` package via `npm root -g`, mirroring how
 * `lib/npx.ts` locates npx. Invoke the real .js directly with the running Node
 * binary — never the OS `pi` shim — so user-controlled args are never parsed
 * by a shell.
 */
export function findPiCli(): string | null {
  if (cachedPiCli) return cachedPiCli;
  if (process.env.PI_CLI_PATH && existsSync(process.env.PI_CLI_PATH)) {
    cachedPiCli = process.env.PI_CLI_PATH;
    return cachedPiCli;
  }
  try {
    const nodeModules = execFileSync(
      "npm",
      ["root", "-g"],
      { encoding: "utf8", shell: process.platform === "win32" },
    ).trim();
    if (nodeModules) {
      const candidate = join(
        nodeModules,
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "cli.js",
      );
      if (existsSync(candidate)) {
        cachedPiCli = candidate;
        return candidate;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Run `pi <args>` without a shell. Returns stdout/stderr; throws on failure.
 */
export async function runPi(args: string[], opts: RunPiOptions = {}): Promise<RunPiResult> {
  const cli = findPiCli();
  if (!cli) {
    throw new Error(
      "Could not locate the pi CLI. Install it with `npm i -g @earendil-works/pi-coding-agent` or set PI_CLI_PATH.",
    );
  }
  return execFileAsync(process.execPath, [cli, ...args], {
    timeout: opts.timeout,
    env: opts.env,
  });
}