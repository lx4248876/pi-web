"use client";

import { useState, useEffect, useRef } from "react";
import { createSidebarWidthTracker } from "@/lib/sidebar-width";

interface UseResizablePanelOpts {
  /** 整个 AppShell 容器,用于读取 getBoundingClientRect 计算宽度 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 拖拽手柄元素 */
  handleRef: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  /** 由鼠标 clientX + 容器 rect 计算原始宽度(左栏用 clientX - rect.left,右栏用 rect.right - clientX) */
  computeWidth: (clientX: number, rect: DOMRect) => number;
  /** 初始/默认宽度(无 storageKey 时即初始值) */
  defaultWidth: number;
  /**
   * 若提供 cssVarTargetSelector + cssVarName:拖拽中实时改目标元素的 CSS 变量、不更新 state,
   * 松手才更新 state(左栏模式,靠 CSS 变量实时跟随)。
   * 若都不提供:拖拽中直接 setWidth(右栏模式,靠 state 实时驱动)。
   */
  cssVarTargetSelector?: string;
  cssVarName?: string;
  /** 若提供,宽度持久化到该 localStorage key(右栏用) */
  storageKey?: string;
  /** 是否挂载拖拽监听(右栏依赖 rightPanelOpen;左栏恒 true) */
  enabled?: boolean;
}

/** 合并左右两套拖拽调宽逻辑为一个参数化 hook,保留两套真实差异(实时改 CSS 变量 vs 改 state)。 */
export function useResizablePanel(opts: UseResizablePanelOpts) {
  // 初始恒用 defaultWidth,避免 SSR 首帧与客户端读 localStorage 后的宽度不同导致 hydration mismatch;
  // 已存宽度挂载后再读,只改 state 不影响首帧 HTML。
  const [width, setWidth] = useState<number>(opts.defaultWidth);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;
  const trackerRef = useRef(createSidebarWidthTracker({ min: opts.min, max: opts.max }));

  const storageKey = opts.storageKey;
  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setWidth((w) => (Number.isNaN(parseInt(stored, 10)) ? w : parseInt(stored, 10)));
    } catch { /* localStorage unavailable, fall back to default */ }
  }, [storageKey]);

  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    let localWidth = widthRef.current;

    const onMouseDown = (e: MouseEvent) => {
      if (window.innerWidth <= 640) return;
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      localWidth = widthRef.current;
    };

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !opts.containerRef.current) return;
      const rect = opts.containerRef.current.getBoundingClientRect();
      const result = trackerRef.current.next(opts.computeWidth(e.clientX, rect));
      if (result.changed) {
        localWidth = result.width;
        if (opts.cssVarTargetSelector && opts.cssVarName) {
          const el = opts.containerRef.current.querySelector(opts.cssVarTargetSelector) as HTMLElement | null;
          if (el) el.style.setProperty(opts.cssVarName, `${result.width}px`);
        } else {
          setWidth(result.width);
        }
      }
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth(localWidth);
      if (opts.storageKey) {
        try {
          localStorage.setItem(opts.storageKey, String(localWidth));
        } catch { /* localStorage unavailable, persistence is best-effort */ }
      }
    };

    const handleEl = opts.handleRef.current;
    handleEl?.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      handleEl?.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [enabled]);

  return { width, setWidth, dragging };
}
