/**
 * API Key 输入防呆校验。
 *
 * 背景：API key 输入框只做非空校验，任何文本（含一大段中文/抱怨、多段带空格的
 * 内容）都会被原样存进 auth.json，并静默覆盖已有的正确 key，导致鉴权以错误凭据
 * 请求而 401。此模块为「是否像 API key」提供可单测的启发式判断，供前端内联拦截
 * 和 /api/auth/api-key 服务端强制兜底共用。
 *
 * 注意：这是启发式（heuristic），不是密钥格式标准——只拦明显不可能是 key 的脏值，
 * 不做严格白名单，避免误伤各类真实 key。
 */

export type ApiKeyCheckResult =
  | { ok: true }
  | { ok: false; code: ApiKeyRejectCode; message: string };

export type ApiKeyRejectCode =
  | "EMPTY"
  | "CONTROL"
  | "NOT_API_KEY"
  | "TOO_SHORT";

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
// 中文字符直接判定不可能是 API key（真实 key 不含 CJK）。
const CJK_RE = /\p{Script=Han}/u;
const INTERNAL_WHITESPACE_RE = /\s/;

/** 最小长度：真实 API key 通常较长，过短多半是粘贴不完整。 */
export const MIN_API_KEY_LENGTH = 8;

export function validateApiKeyValue(raw: string): ApiKeyCheckResult {
  const v = raw.trim();

  if (v.length === 0) {
    return { ok: false, code: "EMPTY", message: "API key 不能为空。" };
  }
  if (CONTROL_RE.test(v)) {
    return {
      ok: false,
      code: "CONTROL",
      message: "API key 不能包含换行或控制字符。",
    };
  }
  if (CJK_RE.test(v)) {
    return {
      ok: false,
      code: "NOT_API_KEY",
      message: "看起来不是 API key：不能包含中文内容，请检查是否粘错了文本。",
    };
  }
  if (INTERNAL_WHITESPACE_RE.test(v)) {
    return {
      ok: false,
      code: "NOT_API_KEY",
      message: "看起来不是 API key：不应包含空格或多段文本，请确认只粘贴一把 key。",
    };
  }
  if (v.length < MIN_API_KEY_LENGTH) {
    return {
      ok: false,
      code: "TOO_SHORT",
      message: `API key 过短（至少 ${MIN_API_KEY_LENGTH} 位），可能粘贴不完整。`,
    };
  }
  return { ok: true };
}