"use client";

import {useEffect, useMemo, useState} from "react";
import type {
    ExtensionUIRequest,
    ExtensionUIResponse,
} from "@/hooks/useAgentSession";

export function ExtensionUIDialog({
                               request,
                               onResponse,
}: {
    request: Extract<
        ExtensionUIRequest,
        { method: "select" | "confirm" | "input" | "editor" | "multiple" }
    >;
    onResponse: (response: ExtensionUIResponse) => void;
}) {
    const [value, setValue] = useState(
        request.method === "editor" ? (request.prefill ?? "") : "",
    );
    // 多问题：每个问题各自的选中项（有 options 的）与文本输入（无 options 的）
    const [selections, setSelections] = useState<Record<number, string>>({});
    const [inputs, setInputs] = useState<Record<number, string>>({});
    // 多问题：当前展示第几题（0 基），分页展示，每题一页
    const [page, setPage] = useState(0);
    // 单问题（select）：除了点选项，还允许手输自定义答案兜底
    const [custom, setCustom] = useState("");

    useEffect(() => {
        setValue(request.method === "editor" ? (request.prefill ?? "") : "");
        setSelections({});
        setInputs({});
        setCustom("");
        setPage(0);
    }, [
        request.id,
        request.method,
        request.method === "editor" ? request.prefill : undefined,
    ]);

    const cancel = () =>
        onResponse({
            type: "extension_ui_response",
            id: request.id,
            cancelled: true,
        });
    const submitValue = () =>
        onResponse({type: "extension_ui_response", id: request.id, value});

    // 单问题（select）：自定义输入非空时提交自定义答案
    const submitCustom = () => {
        const text = custom.trim();
        if (!text) return;
        onResponse({ type: "extension_ui_response", id: request.id, value: text });
    };

    // 多问题：总题数、当前是否首/末页，用于分页导航
    const questionCount =
        request.method === "multiple" ? request.questions.length : 0;
    const isFirstPage = page === 0;
    const isLastPage = page >= questionCount - 1;

    // 多问题：校验每问都已作答（选项选中 或 自定义输入），按序收集答案数组回传
    const multipleAnswered = useMemo(() => {
        if (request.method !== "multiple") return true;
        return request.questions.every((q, qi) =>
            q.options && q.options.length > 0
                ? Boolean(selections[qi]) || Boolean((inputs[qi] ?? "").trim())
                : Boolean((inputs[qi] ?? "").trim()),
        );
    }, [request, selections, inputs]);
    const submitMultiple = () => {
        if (request.method !== "multiple") return;
        // 自定义文本优先；没有输入才用选中项
        const answers = request.questions.map((q, qi) => {
            const customText = (inputs[qi] ?? "").trim();
            if (q.options && q.options.length > 0) {
                return customText || (selections[qi] ?? "");
            }
            return customText;
        });
        onResponse({
            type: "extension_ui_response",
            id: request.id,
            value: answers,
        });
    };

    return (
        <div
            style={{
                padding: "0 16px 8px",
                paddingRight: 52, // 16px base + 36px for ChatMinimap alignment
                flexShrink: 0,
            }}
        >
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <div
                style={{
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderTop: "2px solid var(--accent)",
                    borderRadius: 10,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                    padding: 16,
                }}
            >
                <div
                    className="mb-3 flex items-center gap-2 text-[15px] font-semibold"
                    style={{ color: "var(--text)" }}
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ flexShrink: 0 }}
                    >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {request.title}
                </div>

                {request.method === "select" && (
                    <div className="flex flex-col gap-2">
                        {request.options.map((option) => (
                            <button
                                key={option}
                                onClick={() =>
                                    onResponse({
                                        type: "extension_ui_response",
                                        id: request.id,
                                        value: option,
                                    })
                                }
                                className="w-full text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
                                style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    padding: "9px 10px",
                                    color: "var(--text)",
                                    // 选项文本可能带 "\n"（label 后拼接的 description），
                                    // 保留换行渲染成 option 的第二行说明，而不是缩成一个长标签。
                                    whiteSpace: "pre-line",
                                    lineHeight: 1.5,
                                }}
                            >
                                {option}
                            </button>
                        ))}
                        <input
                            value={custom}
                            placeholder="或输入自定义答案…"
                            onChange={(e) => setCustom(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") submitCustom();
                                if (e.key === "Escape") cancel();
                            }}
                            className="w-full text-sm outline-none"
                            style={{
                                background: "var(--bg)",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                color: "var(--text)",
                                padding: "9px 10px",
                            }}
                        />
                    </div>
                )}

                {request.method === "multiple" && (
                    <div className="flex flex-col gap-4">
                        {questionCount > 0 && (
                            <div
                                className="text-xs"
                                style={{ color: "var(--text-muted)" }}
                            >
                                第 {page + 1} / {questionCount} 题
                            </div>
                        )}
                        {request.questions.slice(page, page + 1).map((q, qi) => {
                            const idx = page + qi;
                            return (
                                <div key={idx} className="flex flex-col gap-2">
                                    <div
                                        className="text-sm font-semibold"
                                        style={{ color: "var(--text)" }}
                                    >
                                        {idx + 1}. {q.question}
                                    </div>
                                    {q.options && q.options.length > 0 ? (
                                        <div className="flex flex-col gap-2">
                                            {q.options.map((opt) => {
                                                const selected =
                                                    selections[idx] === opt;
                                                return (
                                                    <button
                                                        key={opt}
                                                        onClick={() =>
                                                            setSelections((s) => ({
                                                                ...s,
                                                                [idx]: opt,
                                                            }))
                                                        }
                                                        className="w-full text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
                                                        style={{
                                                            border: selected
                                                                ? "1px solid var(--accent)"
                                                                : "1px solid var(--border)",
                                                            borderRadius: 6,
                                                            padding: "9px 10px",
                                                            color: "var(--text)",
                                                            whiteSpace:
                                                                "pre-line",
                                                            lineHeight: 1.5,
                                                        }}
                                                    >
                                                        {opt}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                    <input
                                        value={inputs[idx] ?? ""}
                                        placeholder={
                                            q.options && q.options.length > 0
                                                ? "或输入自定义答案…"
                                                : (q.placeholder ?? "输入答案…")
                                        }
                                        onChange={(e) =>
                                            setInputs((s) => ({
                                                ...s,
                                                [idx]: e.target.value,
                                            }))
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                if (isLastPage) submitMultiple();
                                                else setPage((p) => p + 1);
                                            }
                                            if (e.key === "Escape") cancel();
                                        }}
                                        className="w-full text-sm outline-none"
                                        style={{
                                            background: "var(--bg)",
                                            border: "1px solid var(--border)",
                                            borderRadius: 6,
                                            color: "var(--text)",
                                            padding: "9px 10px",
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}

                {request.method === "confirm" && (
                    <div className="text-sm leading-6 text-text-muted">
                        {request.message}
                    </div>
                )}

                {request.method === "input" && (
                    <input
                        autoFocus
                        value={value}
                        placeholder={request.placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") submitValue();
                            if (e.key === "Escape") cancel();
                        }}
                        className="w-full text-sm outline-none"
                        style={{
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            padding: "9px 10px",
                        }}
                    />
                )}

                {request.method === "editor" && (
                    <textarea
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") cancel();
                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submitValue();
                        }}
                        rows={8}
                        className="w-full resize-none text-sm outline-none"
                        style={{
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            padding: "9px 10px",
                        }}
                    />
                )}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        onClick={cancel}
                        className="text-sm transition-colors hover:bg-[var(--bg-hover)]"
                        style={{
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text-muted)",
                            padding: "7px 12px",
                        }}
                    >
                        Cancel
                    </button>
                    {request.method === "confirm" ? (
                        <>
                            <button
                                onClick={() =>
                                    onResponse({
                                        type: "extension_ui_response",
                                        id: request.id,
                                        confirmed: false,
                                    })
                                }
                                className="text-sm transition-colors hover:bg-[var(--bg-panel)]"
                                style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    color: "var(--text)",
                                    padding: "7px 12px",
                                }}
                            >
                                No
                            </button>
                            <button
                                onClick={() =>
                                    onResponse({
                                        type: "extension_ui_response",
                                        id: request.id,
                                        confirmed: true,
                                    })
                                }
                                className="text-sm"
                                style={{
                                    border: "1px solid var(--accent)",
                                    borderRadius: 6,
                                    background: "var(--accent)",
                                    color: "white",
                                    padding: "7px 12px",
                                }}
                            >
                                Yes
                            </button>
                        </>
                    ) : request.method === "multiple" ? (
                        !isLastPage ? (
                            <>
                                {!isFirstPage && (
                                    <button
                                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                                        className="text-sm transition-colors hover:bg-[var(--bg-hover)]"
                                        style={{
                                            border: "1px solid var(--border)",
                                            borderRadius: 6,
                                            color: "var(--text)",
                                            padding: "7px 12px",
                                        }}
                                    >
                                        上一题
                                    </button>
                                )}
                                <button
                                    onClick={() => setPage((p) => p + 1)}
                                    className="text-sm"
                                    style={{
                                        border: "1px solid var(--accent)",
                                        borderRadius: 6,
                                        background: "var(--accent)",
                                        color: "white",
                                        padding: "7px 12px",
                                    }}
                                >
                                    下一题
                                </button>
                            </>
                        ) : (
                            <>
                                {!isFirstPage && (
                                    <button
                                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                                        className="text-sm transition-colors hover:bg-[var(--bg-hover)]"
                                        style={{
                                            border: "1px solid var(--border)",
                                            borderRadius: 6,
                                            color: "var(--text)",
                                            padding: "7px 12px",
                                        }}
                                    >
                                        上一题
                                    </button>
                                )}
                                <button
                                    onClick={submitMultiple}
                                    disabled={!multipleAnswered}
                                    className="text-sm"
                                    style={{
                                        border: "1px solid var(--accent)",
                                        borderRadius: 6,
                                        background: multipleAnswered
                                            ? "var(--accent)"
                                            : "var(--bg-selected)",
                                        color: multipleAnswered
                                            ? "white"
                                            : "var(--text-muted)",
                                        padding: "7px 12px",
                                        cursor: multipleAnswered
                                            ? "pointer"
                                            : "not-allowed",
                                    }}
                                >
                                    {multipleAnswered ? "提交" : "请完成所有问题"}
                                </button>
                            </>
                        )
                    ) : request.method === "select" ? (
                        custom.trim() ? (
                            <button
                                onClick={submitCustom}
                                className="text-sm"
                                style={{
                                    border: "1px solid var(--accent)",
                                    borderRadius: 6,
                                    background: "var(--accent)",
                                    color: "white",
                                    padding: "7px 12px",
                                }}
                            >
                                提交自定义答案
                            </button>
                        ) : null
                    ) : (
                        <button
                            onClick={submitValue}
                            className="text-sm"
                            style={{
                                border: "1px solid var(--accent)",
                                borderRadius: 6,
                                background: "var(--accent)",
                                color: "white",
                                padding: "7px 12px",
                            }}
                        >
                            Submit
                        </button>
                    )}
                </div>
            </div>
        </div>
    </div>
    );
}
