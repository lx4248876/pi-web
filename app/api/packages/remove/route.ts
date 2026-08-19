import { NextResponse } from "next/server";
import { removePiPackage } from "@/lib/pi-packages";

export const dynamic = "force-dynamic";

// POST /api/packages/remove  body: { package: string; scope?: "global" | "project" }
// Removes (uninstalls) a pi package via `pi remove npm:<name>`. Default global.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { package?: string; scope?: string };
    const pkg = body.package?.trim();
    if (!pkg) return NextResponse.json({ error: "package required" }, { status: 400 });

    const scope = body.scope === "project" ? "project" : "global";
    const output = await removePiPackage(pkg, scope);
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(/\x1B\[[0-9;]*m/g, "");
    return NextResponse.json({ error: output || (err.message ?? String(e)) }, { status: 500 });
  }
}