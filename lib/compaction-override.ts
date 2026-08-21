/**
 * 模型级自动压缩阈值 → pi compaction 设置的换算层。
 *
 * pi 原生自动压缩规则（compaction.js shouldCompact）：
 *   contextTokens > contextWindow - reserveTokens 时触发。
 * 用户在模型配置里填的是「阈值」（autoCompactThreshold，上下文超过该值就压），
 * 所以换算 reserveTokens = contextWindow - threshold。
 *
 * 约定（已与用户确认）：
 * - 没填 / 无效阈值 / 模型没有 contextWindow / 阈值 >= contextWindow → 关闭自动压缩
 *   （enabled:false 会连「上下文溢出兜底压缩」一起关掉，用户已接受该语义）。
 * - applyOverrides 只改内存不落盘（pi SettingsManager 已核实），models.json 是唯一配置真身。
 */

export type CompactionOverride =
  | { enabled: true; reserveTokens: number }
  | { enabled: false };

export interface CompactionOverrideInput {
 /** models.json 模型条目里的原始阈值 */
  autoCompactThreshold?: number | null;
  /** 该模型 contextWindow（pi Model 对象上的字段） */
  contextWindow?: number | null;
}

/** 阈值 → overrides。纯函数，无 IO。 */
export function resolveCompactionOverride(
  input: CompactionOverrideInput,
): CompactionOverride {
  const { autoCompactThreshold, contextWindow } = input;
  const threshold = autoCompactThreshold;
  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold <= 0) {
    return { enabled: false };
  }
  const window = contextWindow;
  if (typeof window !== "number" || !Number.isFinite(window) || window <= 0) {
    return { enabled: false };
  }
  const reserveTokens = Math.floor(window - threshold);
  if (reserveTokens <= 0) {
    // 阈值 >= 窗口：换算出的 reserve 非正，视为无效配置（关闭而不是永不触发，
    // 让用户在面板上看到「没生效」比静默完全不触发更可预期）。
    return { enabled: false };
  }
  return { enabled: true, reserveTokens };
}

export interface CompactionModelLike {
  contextWindow?: number;
  autoCompactThreshold?: number | null;
}

export interface SettingsManagerLike {
  applyOverrides(overrides: unknown): void;
}

/**
 * 把换算结果写进 settingsManager（内存态，不落盘）。
 * 没填阈值时也要显式 enabled:false —— pi 默认 compaction.enabled=true，
 * 不覆盖的话「没填=不开启」会被默认值击穿。
 */
export function applyCompactionOverride(
  settingsManager: SettingsManagerLike,
  model: CompactionModelLike | undefined,
): void {
  if (!model) return;
  const resolved = resolveCompactionOverride({
    autoCompactThreshold: model.autoCompactThreshold,
    contextWindow: model.contextWindow,
  });
  settingsManager.applyOverrides(
    resolved.enabled
      ? { compaction: { enabled: true, reserveTokens: resolved.reserveTokens } }
      : { compaction: { enabled: false } },
  );
}

/**
 * 从 models.json 读取某模型条目的 autoCompactThreshold 原始值。
 * 读取器注入（默认 undefined，由调用方提供真实实现），便于纯函数测试。
 * models.json 损坏 / 条目缺失 / 字段非数字 → undefined（视为未配置）。
 */
export function readAutoCompactThreshold(
  provider: string,
  modelId: string,
  getModelEntry: (
    provider: string,
    modelId: string,
  ) => Record<string, unknown> | undefined | null,
): number | undefined {
  let entry: Record<string, unknown> | undefined | null;
  try {
    entry = getModelEntry(provider, modelId);
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;
  const raw = entry.autoCompactThreshold;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

/**
 * 压缩中拦截：rpc-manager 的 prompt/steer/follow_up 在 isCompacting 时拒绝。
 * 抽成纯函数以便 TDD；错误消息中文，前端 catch 后直接展示。
 */
export function assertNotCompacting(isCompacting: boolean): void {
  if (isCompacting) {
    throw new Error("正在压缩上下文，请稍候再发送…");
  }
}
