"use client";

import { forwardRef } from "react";
import {
  MarkdownEditor,
  type MarkdownEditorProps,
  type MarkdownEditorRef,
} from "../editor-kit";
import "./styles/mini-editor.css";

export const MINI_TOOLBAR_ITEM_IDS = [
  "undo",
  "redo",
  "bold",
  "italic",
  "strike",
  "underline",
  "bullet-list",
  "ordered-list",
  "check-list",
  "blockquote",
  "code-block",
  "code-language",
  "link",
  "clearFormat",
] as const;

export type MiniToolbarItemId = (typeof MINI_TOOLBAR_ITEM_IDS)[number];

export interface MiniMarkdownEditorProps
  extends Omit<
    MarkdownEditorProps,
    | "showTitle"
    | "showTOC"
    | "onTOCToggle"
    | "contentWidth"
    | "toolbarItemIds"
    | "floatingToolbarEnabled"
    | "floatingToolbarItemIds"
  > {
  toolbarItemIds?: readonly MiniToolbarItemId[];
  contentWidth?: number;
}

const MiniMarkdownEditor = forwardRef<MarkdownEditorRef, MiniMarkdownEditorProps>(
  function MiniMarkdownEditor({
    className,
    minHeight = "180px",
    placeholder = "Describe what happened, what you expected, and any steps to reproduce.",
    defaultFontSize = 14,
    contentWidth = 720,
    toolbarItemIds = MINI_TOOLBAR_ITEM_IDS,
    ...props
  }, ref) {
    return (
      <MarkdownEditor
        {...props}
        ref={ref}
        className={["mini-editor-kit", className].filter(Boolean).join(" ")}
        minHeight={minHeight}
        placeholder={placeholder}
        defaultFontSize={defaultFontSize}
        contentWidth={contentWidth}
        showTitle={false}
        showTOC={false}
        toolbarItemIds={[...toolbarItemIds]}
        floatingToolbarEnabled={false}
      />
    );
  },
);

export default MiniMarkdownEditor;
