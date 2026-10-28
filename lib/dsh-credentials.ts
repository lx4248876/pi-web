/**
 * 把 DSH 的凭据同步进 pi 的进程环境。
 *
 * 背景：pi 的 `~/.pi/agent/models.json` 里，provider 的 apiKey 写的是 `$DGRID_*`
 * 这类环境变量引用，而这些变量的真值由 DSH 保存在 `~/.dsh/.credentials.yaml` 的
 * `refs:` 段里。没有这些变量时，pi 判定「provider 未配置」→ 可用模型为 0 → 界面
 * 上模型列表是空的（这不是代码缺陷，是缺凭证）。
 *
 * 这里只做一件事：把 refs 里的键值补进 process.env（已存在的变量不覆盖），
 * 让 pi 自己的 `$ENV` 解析能拿到值。**不写任何文件、不打印任何密文。**
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LoadResult {
  /** 文件是否读到 */
  loaded: boolean;
  /** 实际注入的变量名（只有名字，绝不带值） */
  injected: string[];
  /** 因已存在而跳过的变量名 */
  skipped: string[];
  /** 解析/读取失败原因 */
  error?: string;
}

/** `~/.dsh` 或 `$DSH_HOME`，可用 `PI_WEB_DSH_HOME` 覆盖（测试用）。 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  return env.PI_WEB_DSH_HOME ?? env.DSH_HOME ?? join(homedir(), ".dsh");
}

/**
 * 从 .credentials.yaml 里解析 `refs:` 段。
 *
 * 只支持 DSH 实际写出的形态（缩进键值 + 可选的成对引号），故意不引入 YAML 依赖：
 * 这是一个只读、单段、格式极窄的提取，超出格式的一律忽略而不是猜。
 */
export function parseCredentialRefs(yaml: string): Record<string, string> {
  const refs: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  let inRefs = false;
  let refsIndent = -1;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    if (!inRefs) {
      if (/^refs:\s*$/.test(line.trimEnd())) {
        inRefs = true;
        refsIndent = -1;
      }
      continue;
    }

    // 回到顶层的另一个键（如 records:）就结束 refs 段。
    if (indent === 0) break;
    if (refsIndent === -1) refsIndent = indent;
    if (indent !== refsIndent) continue;

    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (value) refs[name] = value;
  }

  return refs;
}

/**
 * 读取 DSH 凭据并补进 `env`（默认 process.env）。已存在的变量不覆盖，
 * 这样用户显式 export 的 key 始终优先。
 */
export function loadDshCredentialsIntoEnv(
  env: Record<string, string | undefined> = process.env,
  dshHome = resolveDshHome(env),
): LoadResult {
  const result: LoadResult = { loaded: false, injected: [], skipped: [] };

  let yaml: string;
  try {
    yaml = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
  result.loaded = true;

  for (const [name, value] of Object.entries(parseCredentialRefs(yaml))) {
    if (env[name]) {
      result.skipped.push(name);
      continue;
    }
    env[name] = value;
    result.injected.push(name);
  }

  return result;
}