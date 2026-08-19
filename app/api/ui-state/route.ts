import { NextResponse } from "next/server";
import { readUiState, setUiState } from "@/lib/ui-state";

export const dynamic = "force-dynamic";

// GET /api/ui-state — 服务端持久化的 UI 状态（隐藏项目列表等）
export async function GET() {
  try {
    return NextResponse.json(readUiState());
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/ui-state — 合并保存；body 可任选其一或都带：
// { hiddenCwds?: Record<string,boolean>, trashedSessions?: string[] }
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      hiddenCwds?: unknown;
      trashedSessions?: unknown;
    };
    if (
      body.hiddenCwds !== undefined &&
      (body.hiddenCwds === null ||
        typeof body.hiddenCwds !== "object" ||
        Array.isArray(body.hiddenCwds))
    ) {
      return NextResponse.json({ error: "invalid hiddenCwds" }, { status: 400 });
    }
    if (
      body.trashedSessions !== undefined &&
      (body.trashedSessions === null ||
        !Array.isArray(body.trashedSessions) ||
        !body.trashedSessions.every((s) => typeof s === "string"))
    ) {
      return NextResponse.json(
        { error: "invalid trashedSessions" },
        { status: 400 }
      );
    }
    if (body.hiddenCwds === undefined && body.trashedSessions === undefined) {
      return NextResponse.json(
        { error: "nothing to update" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      setUiState({
        ...(body.hiddenCwds !== undefined
          ? { hiddenCwds: body.hiddenCwds as Record<string, boolean> }
          : {}),
        ...(body.trashedSessions !== undefined
          ? { trashedSessions: body.trashedSessions as string[] }
          : {}),
      })
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
