"use client";

import {useState} from "react";
import type {AgentMessage, ToolResultMessage} from "@/lib/types";

// 统一维护会话级 todo 清单：扫全部消息，取“最后一份”含 details.todos 的结果，
// 即当前会话最新的完整清单（todo 工具每次返回的 details 都带全量清单）。
export interface TodoItem {
	id: number;
	text: string;
	done: boolean;
}

export interface TodoDetails {
	action?: string;
	todos?: TodoItem[];
	nextId?: number;
	error?: string;
}

export function latestTodoDetails(messages: AgentMessage[]): TodoDetails | null {
	let found: TodoDetails | null = null;
	for (const msg of messages) {
		if (msg.role !== "toolResult") continue;
		const res = msg as ToolResultMessage;
		const d = res.details as TodoDetails | undefined;
		if (d && Array.isArray(d.todos)) found = d;
	}
	return found;
}

// 输入框上方的常驻 todo 条：默认折叠为一行，点击展开清单。无 todo 时整体隐藏。
export function TodoStrip({details}: { details: TodoDetails | null }) {
	const [expanded, setExpanded] = useState(false);
	const todos = details?.todos ?? [];
	if (!details || todos.length === 0) return null;
	const done = todos.filter((t) => t.done).length;

	return (
		<div
			style={{
				// 外层与 ChatInput 相同：padding 0 16px + paddingRight 52(minimap 对齐)
				paddingTop: 0,
				paddingLeft: 16,
				paddingRight: 52,
				paddingBottom: 8,
				fontSize: 12,
			}}
		>
			{/* 同输入框一列的宽度：maxWidth 820 + margin auto，卡片自身宽同输入框 */}
			<div
				style={{
					maxWidth: 820,
					margin: "0 auto",
				}}
			>
				<div
					style={{
						border: "1px solid var(--border)",
						borderRadius: 8,
						background: "var(--bg-panel)",
						boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
						overflow: "hidden",
					}}
				>
					<button
						onClick={() => setExpanded((v) => !v)}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							width: "100%",
							padding: "7px 12px",
							background: "none",
							border: "none",
							color: "var(--text-muted)",
							cursor: "pointer",
							fontSize: 12,
							textAlign: "left",
						}}
					>
						<span style={{flexShrink: 0}}>📋 Todo</span>
						<span
							style={{
								color: "var(--text-dim)",
								fontVariantNumeric: "tabular-nums",
								fontSize: 11,
							}}
						>
							{done}/{todos.length} completed
						</span>
						<span
							style={{marginLeft: "auto", color: "var(--text-dim)", fontSize: 10}}
						>
							{expanded ? "收起" : "展开"}
						</span>
					</button>

					{expanded && (
						<div
							style={{
								borderTop: "1px solid var(--border)",
								padding: "7px 12px 9px",
								display: "flex",
								flexDirection: "column",
								gap: 5,
							}}
						>
							{todos.map((t) => (
								<div
									key={t.id}
									style={{display: "flex", alignItems: "baseline", gap: 8}}
								>
									<span
										style={{
											color: t.done ? "#16a34a" : "var(--text-dim)",
											flexShrink: 0,
										}}
									>
										{t.done ? "✓" : "○"}
									</span>
									<span
										style={{
											color: "var(--accent)",
											fontFamily: "var(--font-mono)",
											fontSize: 11,
											flexShrink: 0,
										}}
									>
										#{t.id}
									</span>
									<span
											style={{
												color: t.done ? "var(--text-dim)" : "var(--text)",
												textDecoration: t.done
													? "line-through"
													: "none",
											}}
									>
										{t.text}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}