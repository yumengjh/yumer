import { useCallback, useEffect, useRef, useState } from "react";
import DesktopToolbar from "./DesktopToolbar";
import { useMarkdownEditorContext } from "../EditorContext";

interface FloatingSelectionToolbarProps {
  enabledItemIds?: ReadonlySet<string>;
  delayMs?: number;
}

interface FloatingToolbarPosition {
  left: number;
  top: number;
}

export default function FloatingSelectionToolbar({
  enabledItemIds,
  delayMs = 180,
}: FloatingSelectionToolbarProps) {
  const { editor } = useMarkdownEditorContext();
  const shellRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isVisibleRef = useRef(false);
  const [position, setPosition] = useState<FloatingToolbarPosition>({ left: -9999, top: -9999 });
  const [isVisible, setIsVisible] = useState(false);

  const updateVisibility = useCallback((nextVisible: boolean) => {
    if (isVisibleRef.current === nextVisible) return;
    isVisibleRef.current = nextVisible;
    setIsVisible(nextVisible);
  }, []);

  const updatePosition = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!editor || editor.isDestroyed || !editor.isEditable) {
      updateVisibility(false);
      return;
    }

    const { selection } = editor.state;
    if (selection.empty) {
      updateVisibility(false);
      return;
    }

    try {
      const from = Math.min(selection.from, selection.to);
      const to = Math.max(selection.from, selection.to);
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const rawLeft = (start.left + end.right) / 2;
      const rawTop = Math.min(start.top, end.top) - 10;
      const viewportWidth = window.innerWidth;

      const nextPosition = {
        left: Math.min(Math.max(rawLeft, 18), viewportWidth - 18),
        top: Math.max(rawTop, 56),
      };

      if (delayMs <= 0) {
        setPosition(nextPosition);
        updateVisibility(true);
        return;
      }

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(() => {
        setPosition(nextPosition);
        updateVisibility(true);
        timerRef.current = null;
      }, delayMs);
    } catch {
      updateVisibility(false);
    }
  }, [delayMs, editor, updateVisibility]);

  useEffect(() => {
    if (!editor) return;

    const scheduleUpdate = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        updatePosition();
      });
    };

    const hideIfOutsideEditor = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (shellRef.current?.contains(target)) return;
      if (editor.view.dom.contains(target)) return;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      updateVisibility(false);
    };

    editor.on("selectionUpdate", scheduleUpdate);
    editor.on("transaction", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("pointerdown", hideIfOutsideEditor, true);
    scheduleUpdate();

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      editor.off("selectionUpdate", scheduleUpdate);
      editor.off("transaction", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("pointerdown", hideIfOutsideEditor, true);
    };
  }, [editor, updatePosition, updateVisibility]);

  const reallyVisible = isVisible && Boolean(enabledItemIds) && enabledItemIds!.size > 0;

  return (
    <div
      ref={shellRef}
      className={`floating-selection-toolbar ${reallyVisible ? "is-visible" : ""}`}
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <DesktopToolbar variant="floating" enabledItemIds={enabledItemIds || new Set()} />
    </div>
  );
}
