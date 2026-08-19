import { NextResponse } from "next/server";
import { listInstalledPackages } from "@/lib/pi-packages";

export const dynamic = "force-dynamic";

// GET /api/packages/list-installed
// Returns the set of pi packages installed locally (via `pi list`), so the UI
// can tag marketplace packages as already installed.
export async function GET() {
  try {
    const packages = await listInstalledPackages();
    return NextResponse.json({ packages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}