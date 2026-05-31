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
  const [position, setPosition] = useState<FloatingToolbarPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!editor || editor.isDestroyed || !editor.isEditable) {
      setPosition(null);
      return;
    }

    const { selection } = editor.state;
    if (selection.empty) {
      setPosition(null);
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
        return;
      }

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(() => {
        setPosition(nextPosition);
        timerRef.current = null;
      }, delayMs);
    } catch {
      setPosition(null);
    }
  }, [delayMs, editor]);

  useEffect(() => {
    if (!editor) return;

    const scheduleUpdate = () => {
      window.requestAnimationFrame(updatePosition);
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
      setPosition(null);
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
      editor.off("selectionUpdate", scheduleUpdate);
      editor.off("transaction", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("pointerdown", hideIfOutsideEditor, true);
    };
  }, [editor, updatePosition]);

  if (!position || !enabledItemIds || enabledItemIds.size === 0) return null;

  return (
    <div
      ref={shellRef}
      className="floating-selection-toolbar"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <DesktopToolbar variant="floating" enabledItemIds={enabledItemIds} />
    </div>
  );
}
