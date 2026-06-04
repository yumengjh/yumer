import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { highlightBlockColors } from "./Toolbar/data";

export default function HighlightBlockView({
  node,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const bgColor = node.attrs.backgroundColor || "#FFF2CC";
  const [isFocused, setIsFocused] = useState(false);

  const checkFocus = useCallback(() => {
    if (!editor || !editor.state) return;
    const { from } = editor.state.selection;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const nodeSize = node.nodeSize;
    setIsFocused(from >= pos && from <= pos + nodeSize);
  }, [editor, getPos, node]);

  useEffect(() => {
    if (!editor) return;
    checkFocus();
    editor.on("selectionUpdate", checkFocus);
    editor.on("transaction", checkFocus);
    return () => {
      editor.off("selectionUpdate", checkFocus);
      editor.off("transaction", checkFocus);
    };
  }, [editor, checkFocus]);

  return (
    <NodeViewWrapper
      className="highlight-block-view"
      style={{ backgroundColor: bgColor }}
    >
      {isFocused && (
        <div
          className="highlight-block-color-bar"
          contentEditable={false}
        >
          {highlightBlockColors.map((color) => (
            <button
              key={color}
              type="button"
              className={`highlight-block-swatch ${bgColor === color ? "is-active" : ""}`}
              style={{ backgroundColor: color }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                updateAttributes({ backgroundColor: color });
              }}
            />
          ))}
        </div>
      )}
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
