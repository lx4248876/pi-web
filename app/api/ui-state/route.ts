import { NextResponse } from "next/server";
import { readUiState, setHiddenCwds } from "@/lib/ui-state";

export const dynamic = "force-dynamic";

// GET /api/ui-state — 服务端持久化的 UI 状态（隐藏项目列表等）
export async function GET() {
  try {
    return NextResponse.json(readUiState());
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/ui-state — 整体保存；body: { hiddenCwds: Record<string, boolean> }
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { hiddenCwds?: unknown };
    if (
      !body.hiddenCwds ||
      typeof body.hiddenCwds !== "object" ||
      Array.isArray(body.hiddenCwds)
    ) {
      return NextResponse.json({ error: "invalid hiddenCwds" }, { status: 400 });
    }
    return NextResponse.json(setHiddenCwds(body.hiddenCwds as Record<string, boolean>));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
