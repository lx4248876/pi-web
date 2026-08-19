import { NextResponse } from "next/server";
import { fetchPiPackages } from "@/lib/pi-packages";

export const dynamic = "force-dynamic";

const MAX_PAGE = 600; // hard cap to avoid runaway scraping

// GET /api/packages?name=<q>&type=<type>&page=<n>
// Returns the pi.dev/packages listing (filtered by server-side `name` / `type`
// query params mirrored from pi.dev itself), plus totalPages for pagination.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name")?.trim();
    const type = searchParams.get("type")?.trim();
    const pageRaw = searchParams.get("page");

    let page: number | undefined;
    if (pageRaw) {
      const n = Number(pageRaw);
      if (!Number.isFinite(n) || n < 1 || n > MAX_PAGE) {
        return NextResponse.json({ error: `invalid page: ${pageRaw}` }, { status: 400 });
      }
      page = Math.floor(n);
    }

    const { packages, totalPages } = await fetchPiPackages({
      name: name || undefined,
      type: type || undefined,
      page,
    });

    return NextResponse.json({ packages, totalPages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}