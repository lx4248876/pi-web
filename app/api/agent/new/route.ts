import { NextResponse } from "next/server";
import { startRpcSession } from "@/lib/rpc-manager";
import { createNewAgentSession } from "@/lib/agent-new-flow";

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const result = await createNewAgentSession(body, startRpcSession);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
