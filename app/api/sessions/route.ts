import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getActiveRpcSessionIds } from "@/lib/rpc-manager";

export async function GET() {
  try {
    const sessions = await listAllSessions({
      runningSessionIds: getActiveRpcSessionIds(),
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
