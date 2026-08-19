import { getAllPendingDialogs } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/pending-questions
//
// 返回所有 live 会话中仍有“未答 question”的弹窗请求（按会话）。
// 这是侧边栏「待答」徽标的数据源：不打断、不全局弹窗，只让用户一眼看到
// 哪个会话还有没回答的问题（点进去就能答）。刷新页面后此接口仍给出全部，
// 两个会话同时挂未答 question 时一个都不会丢。
export async function GET() {
	return Response.json({ ok: true, pending: getAllPendingDialogs() });
}