import { useCallback, useEffect, useRef, useState } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseDraggableOptions {
  panelRef: React.RefObject<HTMLElement | null>;
  enabled?: boolean;
}

/** 是否为交互元素（不应触发拖拽） */
function isInteractive(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest(
    "button, input, textarea, select, .ant-input, .ant-switch, .ant-btn, .ant-select, .ant-dropdown, .ant-tooltip",
  );
}

export function useDraggable({
  panelRef,
  enabled = true,
}: UseDraggableOptions) {
  const positionRef = useRef<Position | null>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef<Position>({ x: 0, y: 0 });
  const [position, setPosition] = useState<Position | null>(null);

  const updatePosition = useCallback((pos: Position | null) => {
    positionRef.current = pos;
    setPosition(pos);
  }, []);

  // 全局 mousedown：检查点击是否在面板内、非交互元素上
  useEffect(() => {
    if (!enabled) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const panel = panelRef.current;
      if (!panel) return;

      const target = e.target as HTMLElement;
      // 必须点击在面板内部
      if (!panel.contains(target)) return;
      // 交互元素不触发拖拽
      if (isInteractive(target)) return;

      e.preventDefault();

      // 首次拖拽：从 DOM 读真实坐标
      if (positionRef.current === null) {
        const rect = panel.getBoundingClientRect();
        updatePosition({ x: rect.left, y: rect.top });
        offsetRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      } else {
        offsetRef.current = {
          x: e.clientX - (positionRef.current?.x ?? 0),
          y: e.clientY - (positionRef.current?.y ?? 0),
        };
      }

      draggingRef.current = true;
      // 面板自身禁选 + 全局禁选（双保险）
      panel.style.userSelect = "none";
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [enabled, panelRef, updatePosition]);

  // 全局 mousemove / mouseup
  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const x = e.clientX - offsetRef.current.x;
      const y = e.clientY - offsetRef.current.y;
      updatePosition({
        x: Math.max(0, Math.min(x, window.innerWidth - 100)),
        y: Math.max(0, Math.min(y, window.innerHeight - 48)),
      });
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const panel = panelRef.current;
      if (panel) panel.style.userSelect = "";
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [enabled, updatePosition, panelRef]);

  const reset = useCallback(() => updatePosition(null), [updatePosition]);

  return { position, reset };
}
