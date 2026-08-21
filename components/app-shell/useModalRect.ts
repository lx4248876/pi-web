"use client";

import { useRef, useState } from "react";

/**
 * 弹窗矩形（位置 + 大小），供可拖动/可缩放弹窗记忆尺寸用。
 */
export interface ModalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 四周留白，保证弹窗始终有可抓的边、不会完全跑出视口
const EDGE = 12;
export const MODAL_MIN_WIDTH = 360;
export const MODAL_MIN_HEIGHT = 260;

/** 把矩形夹进视口内（至少露出可操作部分），并限制最小尺寸。纯函数，可单测。 */
export function clampModalRect(r: ModalRect): ModalRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(r.width, MODAL_MIN_WIDTH), vw - 2 * EDGE);
  const height = Math.min(Math.max(r.height, MODAL_MIN_HEIGHT), vh - 2 * EDGE);
  const x = Math.max(EDGE, Math.min(r.x, vw - width - EDGE));
  const y = Math.max(EDGE, Math.min(r.y, vh - height - EDGE));
  return { x, y, width, height };
}

/** 读取记忆的矩形；没有或不可用则返回 undefined（由调用方决定居中回退）。 */
function loadRect(storageKey: string): ModalRect | undefined {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const p = JSON.parse(saved) as Partial<ModalRect>;
      return clampModalRect({
        x: p.x ?? 0,
        y: p.y ?? 0,
        width: p.width ?? 0,
        height: p.height ?? 0,
      });
    }
  } catch {
    /* localStorage unavailable (privacy mode etc.), fall back to centered */
  }
  return undefined;
}

function persistRect(storageKey: string, r: ModalRect) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(r));
  } catch {
    /* persistence is best-effort */
  }
}

function centeredRect(defaultWidth: number, defaultHeight: number): ModalRect {
  const width = Math.min(defaultWidth, window.innerWidth - 2 * EDGE);
  const height = Math.min(defaultHeight, window.innerHeight - 2 * EDGE);
  return {
    x: Math.round((window.innerWidth - width) / 2),
    y: Math.round((window.innerHeight - height) / 2),
    width,
    height,
  };
}

interface DragState {
  type: "move" | "resize";
  startX: number;
  startY: number;
  startRect: ModalRect;
}

export interface UseModalRectOpts {
  /** localStorage 持久化 key（每个弹窗一个，互不覆盖） */
  storageKey: string;
  /** 无记忆时的默认宽高（px） */
  defaultWidth: number;
  defaultHeight: number;
}

/**
 * 共享的「可拖动 / 可缩放弹窗」矩形状态：
 * - 标题栏 pointerdown 拖动位移；右下角手柄 pointerdown 调宽高；
 * - 每帧用 clampModalRect 夹进视口（窗口缩放后也不会跑出去）；
 * - 松手才持久化到 localStorage，下次打开恢复；
 * - SSR 安全（typeof window 检查，首帧用零矩形）。
 *
 * 从 RightPanel 的既有实现抽取（行为不变），ModelsConfig/SkillsConfig/
 * PackagesConfig 等配置弹窗复用，获得拖拽调大小 + 刷新继承能力。
 */
export function useModalRect(opts: UseModalRectOpts) {
  const [rect, setRect] = useState<ModalRect>(() => {
    if (typeof window === "undefined") {
      return { x: 0, y: 0, width: opts.defaultWidth, height: opts.defaultHeight };
    }
    return loadRect(opts.storageKey) ?? centeredRect(opts.defaultWidth, opts.defaultHeight);
  });
  const dragRef = useRef<DragState | null>(null);

  const beginDrag = (type: DragState["type"], e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    dragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startRect: clampModalRect(rect),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cursor = type === "move" ? "move" : "nwse-resize";
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
  };

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => beginDrag("move", e);
  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => beginDrag("resize", e);

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // 从固定起点算，绝不累加 —— 鼠标挪多少就精确移动/缩放多少
    setRect(
      clampModalRect(
        d.type === "move"
          ? { ...d.startRect, x: d.startRect.x + dx, y: d.startRect.y + dy }
          : { ...d.startRect, width: d.startRect.width + dx, height: d.startRect.height + dy },
      ),
    );
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    persistRect(opts.storageKey, clampModalRect(rect));
  };

  // 每次渲染夹一次，窗口缩放后也不会跑出视口（不改 state，用计算值渲染）
  const clampedRect = typeof window === "undefined" ? rect : clampModalRect(rect);

  return {
    rect,
    clampedRect,
    handleBarPointerDown,
    handleResizePointerDown,
    onPointerMove,
    onPointerUp,
  };
}
