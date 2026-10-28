import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { runGitAction } from "@/lib/git-status-exec";

export const dynamic = "force-dynamic";

// Thin transport shell: parse the body ONCE, hand it to the action layer.
//
// The previous version re-read `req.json()` inside the `write-file` branch,
// which made that action fail with "Body is unusable" on every call.
//
// All command construction, ref/path validation and `execFile` (no shell)
// execution live in lib/git-status-exec.ts so they can be tested with real
// repositories.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Session artifacts live under the pi agent dir, so they are the only
  // directories outside the repo that a diff may read.
  let extraReadRoots: string[] = [];
  try {
    extraReadRoots = [getAgentDir()];
  } catch {
    // Fall through: diffs then stay confined to the repository.
  }

  const result = runGitAction(body, { extraReadRoots });
  return NextResponse.json(result.json, { status: result.status });
}
