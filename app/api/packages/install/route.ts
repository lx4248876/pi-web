import { NextResponse } from "next/server";
import { runPi } from "@/lib/pi-exec";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

// POST /api/packages/install  body: { package: string; scope?: "global" | "project" }
// Installs a pi package from pi.dev via `pi install npm:<name>`.
// Default scope is global (no `-l`); project passes `-l`.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { package?: string; scope?: string };
    const pkg = body.package?.trim();
    if (!pkg) return NextResponse.json({ error: "package required" }, { status: 400 });

    // Allow npm:foo, git:repo, https://..., ./path — pass through verbatim.
    const source = pkg.includes(":") || pkg.startsWith("./")
      ? pkg
      : `npm:${pkg}`;

    const isGlobal = body.scope !== "project";
    const args = ["install", source];
    if (!isGlobal) args.push("-l");

    console.log(`[packages/install] running: pi ${args.join(" ")}`);
    const { stdout, stderr } = await runPi(args, {
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const output = (stdout + stderr).replace(ANSI_RE, "");
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
    const msg = output || err.message || String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}