import { useCallback, useRef, useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { Selection } from "prosemirror-state";
import { useMarkdownEditor } from "../EditorContext";
import { App } from "antd";
import {
  getToolbarState,
  isToolbarItemActive,
  runInlineMarkCommand,
} from "./toolbarState";

export function useToolbarActions() {
  const { message } = App.useApp();
  const editor = useMarkdownEditor();
  const tiptap = editor as Editor | null;
  const savedSelectionRef = useRef<Selection | null>(null);

  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!tiptap) return;

    const rerender = () => {
      forceUpdate((v) => v + 1);
    };

    tiptap.on("transaction", rerender);
    tiptap.on("selectionUpdate", rerender);

    return () => {
      tiptap.off("transaction", rerender);
      tiptap.off("selectionUpdate", rerender);
    };
  }, [tiptap]);

  const isActive = useCallback((id: string): boolean => {
    return isToolbarItemActive(getToolbarState(tiptap), id);
  }, [tiptap]);

  const getCurrentHeadingKey = useCallback((): string => {
    return `${getToolbarState(tiptap).headingLevel}`;
  }, [tiptap]);

  const getCurrentHeadingLevel = useCallback((): string => {
    const level = getToolbarState(tiptap).headingLevel;
    return level > 0 ? `标题 ${level}` : "正文";
  }, [tiptap]);

  const handleClick = useCallback((id: string) => {
    if (!tiptap) return;
    switch (id) {
      case "undo":
        tiptap.chain().focus().undo().run();
        break;
      case "redo":
        tiptap.chain().focus().redo().run();
        break;
      case "clearFormat":
        tiptap.chain().focus().unsetAllMarks().clearNodes().run();
        break;
      case "cursor":
        tiptap.chain().focus().run();
        break;
      case "bold":
        runInlineMarkCommand(tiptap, "bold");
        break;
      case "italic":
        runInlineMarkCommand(tiptap, "italic");
        break;
      case "strike":
        runInlineMarkCommand(tiptap, "strike");
        break;
      case "underline":
        runInlineMarkCommand(tiptap, "underline");
        break;
      case "align-left":
        tiptap.chain().focus().setTextAlign("left").run();
        break;
      case "align-center":
        tiptap.chain().focus().setTextAlign("center").run();
        break;
      case "align-right":
        tiptap.chain().focus().setTextAlign("right").run();
        break;
      case "align-justify":
        tiptap.chain().focus().setTextAlign("justify").run();
        break;
      case "bullet-list":
        tiptap.chain().focus().toggleBulletList().run();
        break;
      case "check-list":
        tiptap.chain().focus().toggleTaskList().run();
        break;
      case "ordered-list":
        if (!tiptap.isActive("orderedList")) {
          tiptap.chain().focus().toggleOrderedList().run();
        } else {
          // If active, clicking it again might toggle it off
          tiptap.chain().focus().toggleOrderedList().run();
        }
        break;
      case "blockquote":
        tiptap.chain().focus().toggleBlockquote().run();
        break;
      case "code-block":
        tiptap.chain().focus().toggleCodeBlock().run();
        break;
      case "divider":
        tiptap.chain().focus().setHorizontalRule().run();
        break;
      default:
        break;
    }
    forceUpdate((v) => v + 1);
  }, [tiptap]);

  const setHeading = useCallback((level: number) => {
    if (!tiptap) return;
    if (level === 0) {
      tiptap.chain().focus().setParagraph().run();
    } else if (level >= 1 && level <= 6) {
      tiptap.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }
    forceUpdate((v) => v + 1);
  }, [tiptap]);

  const setTextColor = useCallback((color: string) => {
    if (!tiptap) return;
    tiptap.chain().focus().setColor(color).run();
    forceUpdate((v) => v + 1);
  }, [tiptap]);

  const setBgColor = useCallback((color: string) => {
    if (!tiptap) return;
    tiptap.chain().focus().toggleHighlight({ color }).run();
    forceUpdate((v) => v + 1);
  }, [tiptap]);

  const insertTable = useCallback((rows: number, cols: number) => {
    if (!tiptap) return;
    tiptap.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    forceUpdate((v) => v + 1);
  }, [tiptap]);

  const openLinkPopup = useCallback((onOpen: (text: string, url: string, x: number, y: number) => void) => {
    if (!tiptap) return;
    savedSelectionRef.current = tiptap.state.selection;
    const { from, to } = tiptap.state.selection;
    const selectedText = tiptap.state.doc.textBetween(from, to);
    const existingLink = tiptap.getAttributes("link");
    const { view } = tiptap;
    const coords = view.coordsAtPos(from);
    onOpen(selectedText || "", existingLink.href || "", coords.left, coords.bottom + 8);
  }, [tiptap]);

  const applyLink = useCallback((url: string, text: string) => {
    if (!tiptap) return;
    if (savedSelectionRef.current) {
      const { view } = tiptap;
      view.dispatch(view.state.tr.setSelection(savedSelectionRef.current));
    }
    const finalUrl = url.trim();
    const finalText = text.trim();

    if (!finalUrl) {
      tiptap.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = finalUrl.match(/^https?:\/\//) ? finalUrl : `https://${finalUrl}`;
      const escapeHtml = (str: string) =>
        str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const { from, to } = tiptap.state.selection;
      const currentSelectedText = tiptap.state.doc.textBetween(from, to);

      if (finalText && finalText !== currentSelectedText) {
        tiptap
          .chain()
          .focus()
          .deleteSelection()
          .insertContent(`<a href="${escapeHtml(href)}" class="tiptap-link">${escapeHtml(finalText)}</a>`)
          .run();
      } else {
        tiptap.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    }
  }, [tiptap]);

  return {
    editor: tiptap,
    isActive,
    getCurrentHeadingKey,
    getCurrentHeadingLevel,
    handleClick,
    setHeading,
    setTextColor,
    setBgColor,
    insertTable,
    openLinkPopup,
    applyLink,
    message,
  };
}
