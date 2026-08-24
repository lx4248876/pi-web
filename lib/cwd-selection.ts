export interface BrowseValidationResponse {
  path?: string;
  valid?: boolean;
  error?: string;
}

export interface BrowseDirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface BrowseDirResponse extends BrowseValidationResponse {
  entries?: BrowseDirEntry[];
  requestedPath?: string;
}

export interface SelectCwdSuccess {
  ok: true;
  cwd: string;
}

export interface SelectCwdFailure {
  ok: false;
  error: string;
  fallbackPath?: string;
}

export type SelectCwdResult = SelectCwdSuccess | SelectCwdFailure;

export async function selectCwdWithValidation(
  candidatePath: string,
  validatePath: (path: string) => Promise<BrowseValidationResponse>,
): Promise<SelectCwdResult> {
  const trimmed = candidatePath.trim();
  if (!trimmed) {
    return { ok: false, error: "Path is required" };
  }

  const validation = await validatePath(trimmed);
  if (validation.valid === false) {
    return {
      ok: false,
      error: validation.error ?? "Selected folder is not available",
      fallbackPath: validation.path,
    };
  }

  return { ok: true, cwd: trimmed };
}
