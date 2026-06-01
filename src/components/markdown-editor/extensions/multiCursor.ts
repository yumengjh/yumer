import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

interface MultiCursorState {
  positions: number[];
}

type MultiCursorMeta =
  | { type: "toggle"; pos: number }
  | { type: "set"; positions: number[] }
  | { type: "clear" };

type CursorMovementKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export const MULTI_CURSOR_PLUGIN_KEY = new PluginKey<MultiCursorState>("multiCursor");

function uniqSortedPositions(positions: number[]): number[] {
  return Array.from(new Set(positions)).sort((a, b) => a - b);
}

function resolveTextCursorPosition(view: EditorView, event: MouseEvent): number | null {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;

  const selection = TextSelection.near(
    view.state.doc.resolve(coords.pos),
    coords.inside >= 0 ? 1 : -1,
  );
  if (!selection.empty) return null;

  return selection.from;
}

function readSecondaryCursors(view: EditorView): number[] {
  return MULTI_CURSOR_PLUGIN_KEY.getState(view.state)?.positions ?? [];
}

function resolveNearestTextSelection(view: EditorView, pos: number, bias: -1 | 1): number {
  const safePos = Math.min(Math.max(pos, 0), view.state.doc.content.size);
  return TextSelection.near(view.state.doc.resolve(safePos), bias).from;
}

function resolveCursorFromCoords(view: EditorView, left: number, top: number): number | null {
  const coords = view.posAtCoords({ left, top });
  if (!coords) return null;

  return TextSelection.near(view.state.doc.resolve(coords.pos), 1).from;
}

function getLineStep(view: EditorView, pos: number): number {
  const rect = view.coordsAtPos(pos);
  const dom = view.domAtPos(pos).node;
  const element = dom instanceof HTMLElement ? dom : dom.parentElement;
  const computedLineHeight =
    element instanceof HTMLElement ? Number.parseFloat(getComputedStyle(element).lineHeight) : Number.NaN;

  return Math.max(rect.bottom - rect.top, Number.isFinite(computedLineHeight) ? computedLineHeight : 18, 18);
}

function moveCursorPosition(view: EditorView, pos: number, key: CursorMovementKey): number {
  const { doc } = view.state;

  if (key === "ArrowLeft") {
    return resolveNearestTextSelection(view, pos - 1, -1);
  }

  if (key === "ArrowRight") {
    return resolveNearestTextSelection(view, pos + 1, 1);
  }

  if (key === "Home" || key === "End") {
    const $pos = doc.resolve(pos);
    if ($pos.parent.isTextblock) {
      return key === "Home" ? $pos.start() : $pos.end();
    }

    return resolveNearestTextSelection(view, pos, key === "Home" ? -1 : 1);
  }

  try {
    const rect = view.coordsAtPos(pos);
    const lineStep = getLineStep(view, pos);
    const targetTop = key === "ArrowUp" ? rect.top - lineStep : rect.bottom + lineStep;
    return resolveCursorFromCoords(view, rect.left, targetTop) ?? pos;
  } catch {
    return pos;
  }
}

function updateSecondaryCursorMovement(view: EditorView, key: CursorMovementKey): void {
  const positions = readSecondaryCursors(view);
  if (positions.length === 0) return;

  const nextPositions = uniqSortedPositions(positions.map((pos) => moveCursorPosition(view, pos, key)));
  if (positions.length === nextPositions.length && positions.every((pos, index) => pos === nextPositions[index])) {
    return;
  }

  view.dispatch(view.state.tr.setMeta(MULTI_CURSOR_PLUGIN_KEY, {
    type: "set",
    positions: nextPositions,
  } satisfies MultiCursorMeta));
}

function buildCursorDecorations(state: MultiCursorState, doc: EditorView["state"]["doc"]) {
  const decorations = state.positions.map((pos) =>
    Decoration.widget(
      pos,
      () => {
        const cursor = document.createElement("span");
        cursor.className = "multi-cursor-caret";
        cursor.setAttribute("aria-hidden", "true");
        return cursor;
      },
      { side: -1 },
    ),
  );

  return DecorationSet.create(doc, decorations);
}

function applyTextToCursors(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const secondaryCursors = readSecondaryCursors(view);
  if (secondaryCursors.length === 0) return false;

  const { state } = view;
  const ranges = uniqSortedPositions(secondaryCursors)
    .filter((pos) => pos < from || pos > to)
    .map((pos) => ({ from: pos, to: pos, primary: false }));

  ranges.push({ from, to, primary: true });
  ranges.sort((a, b) => b.from - a.from);

  const tr = state.tr;
  for (const range of ranges) {
    tr.insertText(text, range.from, range.to);
  }

  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, 1)));
  view.dispatch(tr);
  return true;
}

function deleteAroundCursors(view: EditorView, direction: "backward" | "forward"): boolean {
  const secondaryCursors = readSecondaryCursors(view);
  if (secondaryCursors.length === 0) return false;

  const { state } = view;
  const ranges = uniqSortedPositions(secondaryCursors)
    .map((pos) => {
      const $pos = state.doc.resolve(pos);
      if (direction === "backward") {
        return $pos.parentOffset > 0 ? { from: pos - 1, to: pos } : null;
      }
      return $pos.parentOffset < $pos.parent.content.size ? { from: pos, to: pos + 1 } : null;
    })
    .filter((range): range is { from: number; to: number } => Boolean(range));

  const { selection } = state;
  if (selection.empty) {
    const pos = selection.from;
    const $pos = state.doc.resolve(pos);
    if (direction === "backward" && $pos.parentOffset > 0) {
      ranges.push({ from: pos - 1, to: pos });
    } else if (direction === "forward" && $pos.parentOffset < $pos.parent.content.size) {
      ranges.push({ from: pos, to: pos + 1 });
    }
  } else {
    ranges.push({ from: selection.from, to: selection.to });
  }

  if (ranges.length === 0) return true;

  ranges.sort((a, b) => b.from - a.from);
  const tr = state.tr;
  for (const range of ranges) {
    tr.delete(range.from, range.to);
  }

  const nextPrimaryPos = Math.max(1, tr.mapping.map(selection.from, -1));
  tr.setSelection(TextSelection.create(tr.doc, nextPrimaryPos));
  view.dispatch(tr);
  return true;
}

function splitBlockAtCursors(view: EditorView): boolean {
  const secondaryCursors = readSecondaryCursors(view);
  if (secondaryCursors.length === 0) return false;

  const { state } = view;
  const positions = uniqSortedPositions([...secondaryCursors, state.selection.from]).sort((a, b) => b - a);
  const tr = state.tr;

  for (const pos of positions) {
    const $pos = tr.doc.resolve(pos);
    if ($pos.parent.type.spec.code) {
      tr.insertText("\n", pos, pos);
      continue;
    }

    if (canSplit(tr.doc, pos)) {
      tr.split(pos);
    }
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(state.selection.from, 1))));
  view.dispatch(tr);
  return true;
}

export const MultiCursor = Extension.create({
  name: "multiCursor",

  addProseMirrorPlugins() {
    return [
      new Plugin<MultiCursorState>({
        key: MULTI_CURSOR_PLUGIN_KEY,
        state: {
          init: () => ({ positions: [] }),
          apply(tr, pluginState) {
            const meta = tr.getMeta(MULTI_CURSOR_PLUGIN_KEY) as MultiCursorMeta | undefined;
            if (meta?.type === "clear") {
              return { positions: [] };
            }

            let positions = pluginState.positions;
            if (tr.docChanged && positions.length > 0) {
              positions = positions
                .map((pos) => tr.mapping.mapResult(pos, 1))
                .filter((result) => !result.deleted)
                .map((result) => result.pos);
            }

            if (meta?.type === "toggle") {
              const next = positions.includes(meta.pos)
                ? positions.filter((pos) => pos !== meta.pos)
                : [...positions, meta.pos];
              return { positions: uniqSortedPositions(next) };
            }

            if (meta?.type === "set") {
              return { positions: uniqSortedPositions(meta.positions) };
            }

            return positions === pluginState.positions ? pluginState : { positions: uniqSortedPositions(positions) };
          },
        },
        props: {
          decorations(state) {
            const pluginState = MULTI_CURSOR_PLUGIN_KEY.getState(state);
            if (!pluginState || pluginState.positions.length === 0) return null;
            return buildCursorDecorations(pluginState, state.doc);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              if (!(event instanceof MouseEvent)) return false;
              if (event.button !== 0) return false;

              const isMultiCursorClick = event.ctrlKey || event.metaKey;
              if (!isMultiCursorClick) {
                if (readSecondaryCursors(view).length > 0) {
                  view.dispatch(view.state.tr.setMeta(MULTI_CURSOR_PLUGIN_KEY, { type: "clear" }));
                }
                return false;
              }

              const pos = resolveTextCursorPosition(view, event);
              if (pos == null) return false;

              event.preventDefault();
              view.focus();
              view.dispatch(view.state.tr.setMeta(MULTI_CURSOR_PLUGIN_KEY, { type: "toggle", pos }));
              return true;
            },
          },
          handleTextInput(view, from, to, text) {
            return applyTextToCursors(view, from, to, text);
          },
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;

            const handled = applyTextToCursors(
              view,
              view.state.selection.from,
              view.state.selection.to,
              text,
            );
            if (handled) event.preventDefault();
            return handled;
          },
          handleKeyDown(view, event) {
            if (readSecondaryCursors(view).length === 0) return false;

            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(MULTI_CURSOR_PLUGIN_KEY, { type: "clear" }));
              event.preventDefault();
              return true;
            }

            if (event.altKey || event.ctrlKey || event.metaKey) return false;

            if (
              !event.shiftKey &&
              (event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "ArrowUp" ||
                event.key === "ArrowDown" ||
                event.key === "Home" ||
                event.key === "End")
            ) {
              updateSecondaryCursorMovement(view, event.key);
              return false;
            }

            if (event.key === "Backspace") {
              const handled = deleteAroundCursors(view, "backward");
              if (handled) event.preventDefault();
              return handled;
            }

            if (event.key === "Delete") {
              const handled = deleteAroundCursors(view, "forward");
              if (handled) event.preventDefault();
              return handled;
            }

            if (event.key === "Enter") {
              const handled = splitBlockAtCursors(view);
              if (handled) event.preventDefault();
              return handled;
            }

            return false;
          },
        },
      }),
    ];
  },
});
