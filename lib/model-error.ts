// 模型请求错误的解析与用户可读提示。
//
// pi 的协议里，assistant 消息 stopReason:"error" 时 errorMessage 携带底层原始错误。
// 常见形态：
//   - `{"code":"get_channel_failed"}`                         (网关错误码, 可能带 `500 ` 前缀)
//   - `500 {"error":"internal_server_error"}`
//   - `insufficient_quota` / `429 ...`                        (OpenAI 风格码/HTTP 状态)
//   - 纯文本网络错误 (`fetch failed`, `ECONNRESET`, ...)
//
// 本模块负责把任意形态解析成 结构化的 { status, code, message }，
// 并给出一条用户能直接看懂的中文提示。UI（MessageView）与其它调用方共用，避免分散维护。

export interface ParsedModelError {
  /** 能从 `500 {...}` 前缀提取到的 HTTP 状态码 */
  status?: number;
  /** 错误码：网关协议 code 字段、OpenAI error.code、或裸错误码字符串 */
  code?: string;
  /** 提取出的独立错误描述；只有当 body 里确实带 message 类字段才存在
   * （`{"code":...}` 这类只有错误码的 body 不产生 message，避免 UI 重复展示） */
  message?: string;
}

/**
 * 解析任意形态的模型错误字符串。
 * - 提取开头的 HTTP 状态码（`500 {...}` → status 500）
 * - 尝试解析 JSON body：`{"code":...}` / `{"error":{...}}` 两种常见网关/SDK 结构
 * - 其余情况把整串作为 message，尽力从中摘出形如 snake_case / 短横线 的错误码
 */
export function parseModelError(raw: string): ParsedModelError {
  const text = String(raw ?? "").trim();
  if (!text) return { message: "" };

  let status: number | undefined;
  let rest = text;

  // `500 {"code":"..."}` — 状态码前缀
  const statusMatch = /^(\d{3})[\s:]+/.exec(rest);
  if (statusMatch) {
    status = Number(statusMatch[1]);
    rest = text.slice(statusMatch[0].length).trim();
  }

  // JSON body
  if (rest.startsWith("{") || rest.startsWith("[")) {
    try {
      const parsed = JSON.parse(rest);
      if (parsed && typeof parsed === "object") {
        const code =
          typeof parsed.code === "string"
            ? parsed.code
            : typeof parsed.error === "string"
              ? parsed.error
              : typeof parsed.error?.code === "string"
                ? parsed.error.code
                : typeof parsed.error?.type === "string"
                  ? parsed.error.type
                  : undefined;
        const message =
          typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.error?.message === "string"
              ? parsed.error.message
              : undefined;
        return { status, code, message };
      }
    } catch {
      // 不是合法 JSON，按纯文本走
    }
  }

  // 裸错误码 / 纯文本
  const codeMatch = /([a-z][a-z0-9_.-]+_failed|[a-z][a-z0-9_.-]+_error|[a-z]{3,}[_.][a-z0-9_]+)/i.exec(rest);
  return {
    status,
    code: codeMatch?.[1],
    message: rest,
  };
}

/**
 * 根据解析结果给一条用户能看懂的中文提示。
 * 按 网关故障 > 余额 > 限流 > 鉴权 > 网络 > 默认 的优先级归类（与提示的排查价值排序一致）。
 */
export function friendlyModelErrorHint(
  parsed: ParsedModelError,
  raw: string,
): string {
  const lower = raw.toLowerCase();
  const { status, code } = parsed;

  // 网关层错误（HTTP 5xx / 网关内部错误码）—— ui 显示上比网络错误更明确
  const gatewayCode =
    code === "get_channel_failed" ||
    code === "internal_server_error" ||
    code === "gateway_timeout" ||
    code === "bad_gateway" ||
    code === "model_not_found" ||
    code === "channel_not_found";
  // 网关对特定模型渠道明确不可用（new-api/relay 常见）：文案给出可操作建议
  const channelDown =
    /channel is temporarily unavailable|channel.*unavailable|channel.*failed|渠道.*不可用/.test(
      lower,
    ) ||
    code === "get_channel_failed";
  if (channelDown) {
    return "模型渠道暂不可用（网关返回 get_channel_failed）：dgrid 等转发商对该模型的渠道可能故障/过载。请先在右上角切换到其它可用模型，或到网关面板检查该模型渠道状态。";
  }
  if (gatewayCode || (status !== undefined && status >= 500)) {
    return "上游模型网关故障或过载（HTTP " + (status ?? "5xx") +
      "），服务方渠道暂时不可用。请稍后重试，或切换到其它模型/渠道。";
  }

  if (
    /insufficient|balance|quota|credit|payment|余额|额度|欠费|arrears|402/.test(
      lower,
    ) ||
    raw.includes("余额")
  ) {
    return "当前模型账户余额不足或额度用尽，请充值后重试，或在右上角切换到其它可用模型。";
  }

  if (/rate.?limit|too many requests|429/.test(lower)) {
    return "请求过于频繁，已被服务方限流。请稍候片刻再试。";
  }

  if (/unauthor|invalid.*key|api.?key|forbidden|401|403/.test(lower)) {
    return "鉴权失败，API Key 可能无效或已过期。请在模型配置中检查密钥。";
  }

  if (/timeout|timed out|econnreset|network|fetch failed|enotfound/.test(lower)) {
    return "网络异常或请求超时，请检查网络后重试。";
  }

  return "模型请求失败。";
}