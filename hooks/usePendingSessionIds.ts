"use client";

// 轻量轮询：哪些会话当前有「未答 question」。只给侧边栏徽标用（非打断式）——
// 不弹窗、不全局跟随，只是让用户总是知道哪个会话还有问题没回。
// 服务端以 pendingExtensionRequests 为权威事实，刷新后依然返回全部，不丢。

import { useEffect, useState } from "react";

const POLL_MS = 4000;

export function usePendingSessionIds(): ReadonlySet<string> {
	const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const tick = async () => {
			try {
				const res = await fetch("/api/pending-questions");
				const body = (await res.json()) as {
					pending?: Array<{ sessionId: string }>;
				};
				if (!cancelled && Array.isArray(body?.pending)) {
					setIds(new Set(body.pending.map((p) => p.sessionId)));
				}
			} catch {
				// 暂时不可用保持现状，下一轮再试。
			}
			if (!cancelled) timer = setTimeout(tick, POLL_MS);
		};

		tick();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, []);

	return ids;
}