/**
 * LinkToolbar
 * ===========
 * Floating toolbar that appears when hovering over a link in the editor.
 *
 * Hover lifecycle:
 * 1. Plugin fires mouseover on link → sets hoveredLink in plugin state
 * 2. React subscribes to plugin state → shows toolbar immediately
 * 3. React listens for mouseout on editor DOM → if mouse leaves link area,
 *    starts a 300ms hide delay
 * 4. Mouse enters toolbar → cancel hide delay
 * 5. Mouse leaves toolbar → restart hide delay
 * 6. Timer fires → clear React state + dispatch clear-meta to plugin
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Tooltip } from "antd";
import {
  EditOutlined,
  CopyOutlined,
  DisconnectOutlined,
  ExportOutlined,
  CheckOutlined,
  CloseOutlined,
  LinkOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { linkHoverPluginKey, type HoveredLink } from "./extensions/linkExtension";
import type { Editor } from "@tiptap/react";
import "./LinkToolbar.css";

const HIDE_DELAY = 300;
const COPY_RESET_MS = 2000;

interface LinkToolbarProps {
  editor: Editor | null;
}

export default function LinkToolbar({ editor }: LinkToolbarProps) {
  const [hoveredLink, setHoveredLink] = useState<HoveredLink | null>(null);
  const [editing, setEditing] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editText, setEditText] = useState("");
  const [copiedLinkFrom, setCopiedLinkFrom] = useState<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const mouseOverToolbarRef = useRef(false);

  // --- Hide timer management ---

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearHoverState = useCallback(() => {
    setHoveredLink(null);
    setEditing(false);
    if (editor) {
      const tr = editor.view.state.tr;
      tr.setMeta(linkHoverPluginKey, { hoveredLink: null });
      editor.view.dispatch(tr);
    }
  }, [editor]);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!mouseOverToolbarRef.current) {
        clearHoverState();
      }
    }, HIDE_DELAY);
  }, [cancelHide, clearHoverState]);

  // --- Toolbar mouse events ---

  const handleToolbarMouseEnter = useCallback(() => {
    mouseOverToolbarRef.current = true;
    cancelHide();
  }, [cancelHide]);

  const handleToolbarMouseLeave = useCallback(() => {
    mouseOverToolbarRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  // --- Subscribe to plugin state + editor DOM mouseout ---

  useEffect(() => {
    if (!editor) return;

    let disposed = false;
    let domEl: HTMLElement | null = null;

    const updateFromPlugin = () => {
      if (disposed) return;
      try {
        const pluginState = linkHoverPluginKey.getState(editor.view.state);
        const newLink = pluginState?.hoveredLink ?? null;
        if (newLink) {
          cancelHide();
          setHoveredLink(newLink);
        }
      } catch {
        // view not ready yet
      }
    };

    const handleEditorMouseOut = (event: MouseEvent) => {
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (relatedTarget?.closest(".link-hover-toolbar")) return;
      if (relatedTarget?.closest("a.tiptap-link")) return;
      scheduleHide();
    };

    const setup = () => {
      if (disposed) return;
      try {
        domEl = editor.view.dom;
        domEl.addEventListener("mouseout", handleEditorMouseOut);
      } catch {
        // shouldn't happen after create
      }
    };

    editor.on("transaction", updateFromPlugin);

    // defer to next frame so EditorContent has time to mount the view
    const raf = requestAnimationFrame(() => {
      if (disposed) return;
      if (editor.view?.dom) {
        setup();
      } else {
        // still not ready — wait for create
        editor.once("create", setup);
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      editor.off("transaction", updateFromPlugin);
      editor.off("create", setup);
      if (domEl) {
        domEl.removeEventListener("mouseout", handleEditorMouseOut);
      }
      cancelHide();
    };
  }, [editor, cancelHide, scheduleHide]);

  useEffect(() => {
    return () => {
      cancelHide();
      if (copyResetTimerRef.current) window.clearTimeout(copyResetTimerRef.current);
    };
  }, [cancelHide]);

  // --- Actions ---

  const handleVisit = useCallback(() => {
    if (!hoveredLink) return;
    window.open(hoveredLink.href, "_blank", "noopener,noreferrer");
  }, [hoveredLink]);

  const handleCopyText = useCallback(() => {
    if (!hoveredLink) return;
    navigator.clipboard.writeText(hoveredLink.text).then(() => {
      setCopiedLinkFrom(hoveredLink.from);
      if (copyResetTimerRef.current) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedLinkFrom(null);
        copyResetTimerRef.current = null;
      }, COPY_RESET_MS);
    });
  }, [hoveredLink]);

  const handleUnlink = useCallback(() => {
    if (!editor || !hoveredLink) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: hoveredLink.from, to: hoveredLink.to })
      .unsetLink()
      .run();
    clearHoverState();
  }, [editor, hoveredLink, clearHoverState]);

  const handleEditStart = useCallback(() => {
    if (!hoveredLink) return;
    setEditUrl(hoveredLink.href);
    setEditText(hoveredLink.text);
    setEditing(true);
  }, [hoveredLink]);

  const handleEditConfirm = useCallback(() => {
    if (!editor || !hoveredLink) return;

    const url = editUrl.trim();
    const text = editText.trim();

    if (!url) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: hoveredLink.from, to: hoveredLink.to })
        .unsetLink()
        .run();
    } else {
      const href = url.match(/^https?:\/\//) ? url : `https://${url}`;

      if (text && text !== hoveredLink.text) {
        const escapeHtml = (str: string) =>
          str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        editor
          .chain()
          .focus()
          .deleteRange({ from: hoveredLink.from, to: hoveredLink.to })
          .insertContentAt(hoveredLink.from, `<a href="${escapeHtml(href)}" class="tiptap-link">${escapeHtml(text)}</a>`)
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: hoveredLink.from, to: hoveredLink.to })
          .setLink({ href })
          .run();
      }
    }

    setEditing(false);
    clearHoverState();
  }, [editor, hoveredLink, editUrl, editText, clearHoverState]);

  const handleEditCancel = useCallback(() => {
    setEditing(false);
  }, []);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleEditConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleEditCancel();
      }
    },
    [handleEditConfirm, handleEditCancel],
  );

  if (!hoveredLink || !editor) return null;

  const { rect } = hoveredLink;
  const toolbarLeft = rect.left + rect.width / 2;
  const toolbarTop = rect.top - 8;

  const toolbar = editing ? (
    <div
      ref={toolbarRef}
      className="link-hover-toolbar link-hover-toolbar--editing"
      style={{
        position: "fixed",
        left: `${toolbarLeft}px`,
        top: `${toolbarTop}px`,
        transform: "translate(-50%, -100%)",
      }}
      onMouseEnter={handleToolbarMouseEnter}
      onMouseLeave={handleToolbarMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="link-edit-field">
        <LinkOutlined className="link-edit-icon" />
        <Input
          size="small"
          value={editUrl}
          onChange={(e) => setEditUrl(e.target.value)}
          onKeyDown={handleEditKeyDown}
          placeholder="链接地址"
          className="link-edit-input"
          autoFocus
        />
      </div>
      <div className="link-edit-field">
        <span className="link-edit-icon link-edit-icon--text">T</span>
        <Input
          size="small"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleEditKeyDown}
          placeholder="显示文字"
          className="link-edit-input"
        />
      </div>
      <div className="link-edit-actions">
        {hoveredLink.href && (
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              if (!editor) return;
              editor
                .chain()
                .focus()
                .setTextSelection({ from: hoveredLink.from, to: hoveredLink.to })
                .unsetLink()
                .run();
              clearHoverState();
            }}
          >
            移除
          </Button>
        )}
        <div className="link-edit-actions-right">
          <Button size="small" onClick={handleEditCancel}>
            取消
          </Button>
          <Button
            type="primary"
            size="small"
            onClick={handleEditConfirm}
            disabled={!editUrl.trim()}
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  ) : (
    <div
      ref={toolbarRef}
      className="link-hover-toolbar"
      style={{
        position: "fixed",
        left: `${toolbarLeft}px`,
        top: `${toolbarTop}px`,
        transform: "translate(-50%, -100%)",
      }}
      onMouseEnter={handleToolbarMouseEnter}
      onMouseLeave={handleToolbarMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Tooltip title="访问链接">
        <Button
          type="text"
          size="small"
          icon={<ExportOutlined />}
          onClick={handleVisit}
          className="link-toolbar-btn"
        />
      </Tooltip>
      <Tooltip title="编辑链接">
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          onClick={handleEditStart}
          className="link-toolbar-btn"
        />
      </Tooltip>
      <Tooltip title={copiedLinkFrom === hoveredLink.from ? "已复制" : "复制文字"}>
        <Button
          type="text"
          size="small"
          icon={copiedLinkFrom === hoveredLink.from ? <CheckOutlined /> : <CopyOutlined />}
          onClick={handleCopyText}
          className={["link-toolbar-btn", copiedLinkFrom === hoveredLink.from ? "is-copied" : ""].filter(Boolean).join(" ")}
        />
      </Tooltip>
      <Tooltip title="取消链接">
        <Button
          type="text"
          size="small"
          icon={<DisconnectOutlined />}
          onClick={handleUnlink}
          className="link-toolbar-btn"
        />
      </Tooltip>
    </div>
  );

  return createPortal(toolbar, document.body);
}
