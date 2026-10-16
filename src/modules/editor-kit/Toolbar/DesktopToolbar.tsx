import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { App, Dropdown, Popover, Tooltip } from "antd";
import type { Editor } from "@tiptap/react";
import type { Mark } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import { CodeCleanupIcon, YuqueIcon } from "./icons";
import type { YuqueIconName } from "./icons";
import { useMarkdownEditorContext } from "../EditorContext";
import { codeCleanupItems, type CodeCleanupMenuItem } from "./data";
import LinkPickerPopup from "./LinkPickerPopup";
import ColorBoard from "./ColorBoard";
import BlockInsertPanel, { type InsertCardId, type InsertCardOptions } from "../BlockToolbar/BlockInsertPanel";
import { runInsertCard } from "../BlockToolbar/blockInsertContent";
import { runEditorCleanupAction, type EditorCleanupActionKey } from "../code/editorCleanup";
import {
  getToolbarState,
  getToolbarStateSignature,
  runInlineMarkCommand,
  selectionContainsMark,
} from "./toolbarState";
import "./style.css";

/**
 * 顶部工具栏：1:1 复刻语雀（Lake 编辑器 ne-ui-toolbar）。
 * 尺寸、间距、图标、下拉面板均取自语雀编辑页实测（按钮 26px / 下拉按钮 42px / 选择器 71px，
 * 控件间距 8px，带箭头控件相邻 4px、与分隔线相邻 10px）。宽度不足时末尾控件收进「更多」浮层。
 */

interface DesktopToolbarProps {
  variant?: "fixed" | "floating";
  enabledItemIds?: ReadonlySet<string>;
}

type WidgetKind = "insert" | "button" | "select" | "arrow" | "split" | "color" | "divider";

interface Widget {
  id: string;
  kind: WidgetKind;
  render: () => ReactNode;
}

const WIDGET_WIDTH: Record<WidgetKind, number> = {
  insert: 26,
  button: 26,
  select: 71,
  arrow: 42,
  split: 42,
  color: 42,
  divider: 1,
};
/** 「更多」按钮占位：左边线 10px 外边距 + 1px 边线 + 8px + 26px 按钮 */
const MORE_WIDTH = 45;

const ARROW_KINDS = new Set<WidgetKind>(["select", "arrow", "split", "color"]);

/** 语雀的控件间距规则（.ne-toolbar-widget / [data-ne-button-arrow] 相邻选择器） */
function widgetMargin(prev: WidgetKind | null, current: WidgetKind): number {
  if (!prev) return 8;
  if (current === "color") return 8;
  if (current === "split") return prev === "divider" ? 10 : 2;
  const prevArrow = ARROW_KINDS.has(prev);
  const currentArrow = ARROW_KINDS.has(current);
  if (prevArrow && currentArrow) return 4;
  if ((prevArrow && current === "divider") || (prev === "divider" && currentArrow)) return 10;
  return 8;
}

/** 去掉首尾与连续的分隔线 */
function normalizeDividers(widgets: Widget[]): Widget[] {
  const result: Widget[] = [];
  for (const widget of widgets) {
    if (widget.kind === "divider" && (result.length === 0 || result[result.length - 1].kind === "divider")) continue;
    result.push(widget);
  }
  while (result.length && result[result.length - 1].kind === "divider") result.pop();
  return result;
}

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** 快捷键展示：mac 用 ⌥ ⌘ ⇧ 符号（与语雀一致），其它平台用 Ctrl/Alt/Shift */
function kbd(...keys: string[]): string {
  const mac: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧" };
  const win: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift" };
  return keys.map((key) => (IS_MAC ? mac[key] : win[key]) ?? key).join(IS_MAC ? " " : "+");
}

const HEADING_ITEMS = [
  { level: 0, label: "正文", className: "yq-select-item__content" },
  { level: 1, label: "标题1", className: "yq-select-item__h1" },
  { level: 2, label: "标题2", className: "yq-select-item__h2" },
  { level: 3, label: "标题3", className: "yq-select-item__h3" },
  { level: 4, label: "标题4", className: "yq-select-item__h4" },
  { level: 5, label: "标题5", className: "yq-select-item__h5" },
  { level: 6, label: "标题6", className: "yq-select-item__h5" },
] as const;

const FONT_SIZES = ["12px", "13px", "14px", "15px", "16px", "19px", "22px", "24px", "29px", "32px", "40px", "48px"];

const LINE_HEIGHTS = [
  { key: "", label: "默认" },
  { key: "1", label: "1" },
  { key: "1.15", label: "1.15" },
  { key: "1.5", label: "1.5" },
  { key: "2", label: "2" },
  { key: "2.5", label: "2.5" },
  { key: "3", label: "3" },
];

const ALIGN_ITEMS = [
  { key: "left", label: "左对齐", icon: "t-alignment-left" },
  { key: "center", label: "居中对齐", icon: "t-alignment-center" },
  { key: "right", label: "右对齐", icon: "t-alignment-right" },
  { key: "justify", label: "两端对齐", icon: "t-alignment-justify" },
] as const;

// 语雀有序列表样式卡片：预览为 [层级, 序号] 列表
const LIST_STYLE_CARDS: Array<{ key: string; label: string; preview: Array<[number, string]> }> = [
  { key: "decimal", label: "1. a. i.", preview: [[0, "1."], [1, "a."], [1, "b."], [2, "ⅰ."], [0, "2."]] },
  { key: "cjk-ideographic", label: "一、(一) 1.", preview: [[0, "一、"], [1, "(一)"], [1, "(二)"], [2, "1."], [0, "二、"]] },
  { key: "decimal-nested", label: "1. 1.1. 1.2.1.", preview: [[0, "1."], [1, "1.1."], [1, "1.2."], [2, "1.2.1."], [0, "2."]] },
];

const DEFAULT_TEXT_COLOR = "#DF2A3F";
const DEFAULT_BG_COLOR = "#FBDE28";

const CLEANUP_MESSAGES: Record<EditorCleanupActionKey, { success: (count: number) => string; unchanged: string }> = {
  removeTrailingBlankLines: { success: (n) => `已清理 ${n} 个代码块的行尾空行`, unchanged: "没有需要清理的行尾空行" },
  removeEmptyCodeBlocks: { success: (n) => `已删除 ${n} 个空代码块`, unchanged: "没有空代码块" },
  convertSelectedListsToInline: { success: (n) => `已将 ${n} 个列表转为横排文本`, unchanged: "选区中没有可转换的列表" },
  collapseStatusBars: { success: (n) => `已折叠 ${n} 个代码块状态栏`, unchanged: "没有可折叠的状态栏" },
  expandStatusBars: { success: (n) => `已展开 ${n} 个代码块状态栏`, unchanged: "没有可展开的状态栏" },
  enableLineNumbers: { success: (n) => `已为 ${n} 个代码块启用行号`, unchanged: "代码块已全部启用行号" },
  disableLineNumbers: { success: (n) => `已为 ${n} 个代码块关闭行号`, unchanged: "代码块已全部关闭行号" },
};

function isCodeCleanupActionItem(
  item: CodeCleanupMenuItem,
): item is Extract<CodeCleanupMenuItem, { label: string }> {
  return "label" in item;
}

// 格式刷可复制的行内格式
const PAINTABLE_MARKS = ["bold", "italic", "strike", "underline", "code", "superscript", "subscript", "textStyle", "highlight"];

/* ------------------------------------------------------------------ */
/* 基础控件                                                             */
/* ------------------------------------------------------------------ */

function TbTooltip({ title, shortcut, hidden, children }: { title: string; shortcut?: string; hidden?: boolean; children: React.ReactElement }) {
  return (
    <Tooltip
      title={
        <div className="yq-tooltip__content">
          <div>{title}</div>
          {shortcut && <div>{shortcut}</div>}
        </div>
      }
      placement="bottom"
      arrow={false}
      mouseEnterDelay={0.25}
      classNames={{ root: "yq-tooltip" }}
      {...(hidden ? { open: false } : {})}
    >
      {children}
    </Tooltip>
  );
}

const preventMouseDown = (event: React.MouseEvent) => event.preventDefault();

/** 编辑器未挂载 / 已销毁时 commandManager 为空，can() 会抛错 */
function safeCan(editor: Editor | null, command: "undo" | "redo"): boolean {
  if (!editor || editor.isDestroyed) return false;
  try {
    return editor.can()[command]();
  } catch {
    return false;
  }
}

function ArrowDown() {
  return <YuqueIcon name="ToolbarArrowDown" className="yq-tb-arrow-down" />;
}

/* ------------------------------------------------------------------ */
/* 工具栏                                                               */
/* ------------------------------------------------------------------ */

export default function DesktopToolbar({ variant = "fixed", enabledItemIds }: DesktopToolbarProps = {}) {
  const { message } = App.useApp();
  const { editor, defaultFontSize, uploadImage } = useMarkdownEditorContext();
  const tiptap = editor as Editor | null;
  const editorReady = Boolean(tiptap);
  const toolbarState = getToolbarState(tiptap, { defaultFontSize });

  const [, forceUpdate] = useState(0);
  const signatureRef = useRef("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [bgColor, setBgColor] = useState(DEFAULT_BG_COLOR);
  const [cleanupAction, setCleanupAction] = useState<EditorCleanupActionKey>("removeTrailingBlankLines");
  const [painter, setPainter] = useState<{ marks: readonly Mark[]; sticky: boolean } | null>(null);
  const [linkPopup, setLinkPopup] = useState<{ x: number; y: number; text: string; url: string } | null>(null);
  const savedSelectionRef = useRef<Selection | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  // 只在工具栏相关状态变化时重渲染
  const readSignature = useCallback(() => {
    if (!tiptap) return "";
    const state = getToolbarState(tiptap, { defaultFontSize });
    const extra = [
      safeCan(tiptap, "undo"),
      safeCan(tiptap, "redo"),
      selectionContainsMark(tiptap, "superscript"),
      selectionContainsMark(tiptap, "subscript"),
      tiptap.getAttributes("textStyle").color ?? "",
      tiptap.getAttributes("highlight").color ?? "",
    ].join("|");
    return `${getToolbarStateSignature(state)}|${extra}`;
  }, [defaultFontSize, tiptap]);

  useEffect(() => {
    if (!tiptap) return;
    signatureRef.current = readSignature();
    const rerender = () => {
      const next = readSignature();
      if (next === signatureRef.current) return;
      signatureRef.current = next;
      forceUpdate((value) => value + 1);
    };
    tiptap.on("transaction", rerender);
    tiptap.on("selectionUpdate", rerender);
    return () => {
      tiptap.off("transaction", rerender);
      tiptap.off("selectionUpdate", rerender);
    };
  }, [readSignature, tiptap]);

  // 宽度监听：用于收起放不下的控件
  useLayoutEffect(() => {
    if (variant !== "fixed") return;
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const style = getComputedStyle(root);
      setAvailableWidth(root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [variant]);

  /* ---------------- 格式刷：单击刷一次，双击连续刷，Esc 退出 ---------------- */
  useEffect(() => {
    if (!tiptap || !painter) return;
    const dom = tiptap.view.dom as HTMLElement;
    dom.classList.add("yq-format-painting");
    const apply = () => {
      window.setTimeout(() => {
        const { state } = tiptap;
        const { from, to, empty } = state.selection;
        if (empty) return;
        const tr = state.tr;
        for (const name of PAINTABLE_MARKS) {
          const type = state.schema.marks[name];
          if (type) tr.removeMark(from, to, type);
        }
        for (const mark of painter.marks) tr.addMark(from, to, mark);
        tiptap.view.dispatch(tr);
        if (!painter.sticky) setPainter(null);
      }, 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPainter(null);
    };
    dom.addEventListener("mouseup", apply);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      dom.classList.remove("yq-format-painting");
      dom.removeEventListener("mouseup", apply);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [painter, tiptap]);

  const startPainter = (sticky: boolean) => {
    if (!tiptap) return;
    if (painter && !sticky) {
      setPainter(null);
      return;
    }
    const { state } = tiptap;
    const { $from, from, to, empty } = state.selection;
    let marks: readonly Mark[] = $from.marks();
    if (!empty) {
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) {
          marks = node.marks;
          return false;
        }
        return true;
      });
    }
    setPainter({ marks: marks.filter((mark) => PAINTABLE_MARKS.includes(mark.type.name)), sticky });
  };

  /* ---------------- 链接 ---------------- */
  const openLinkPopup = () => {
    if (!tiptap) return;
    savedSelectionRef.current = tiptap.state.selection;
    const { from, to } = tiptap.state.selection;
    const coords = tiptap.view.coordsAtPos(from);
    setLinkPopup({
      x: coords.left,
      y: coords.bottom + 8,
      text: tiptap.state.doc.textBetween(from, to),
      url: tiptap.getAttributes("link").href || "",
    });
  };

  const applyLink = () => {
    if (!tiptap || !linkPopup) return;
    const url = linkPopup.url.trim();
    const text = linkPopup.text.trim();
    if (savedSelectionRef.current) {
      tiptap.view.dispatch(tiptap.state.tr.setSelection(savedSelectionRef.current));
    }
    if (!url) {
      tiptap.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const { from, to } = tiptap.state.selection;
      const selectedText = tiptap.state.doc.textBetween(from, to);
      if (text && text !== selectedText) {
        tiptap
          .chain()
          .focus()
          .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
          .run();
      } else {
        tiptap.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    }
    setLinkPopup(null);
  };

  /* ---------------- 插入 ---------------- */
  const handleImageFile = useCallback(
    async (file: File) => {
      if (!tiptap) return;
      if (!uploadImage) {
        message.error("未选择工作空间");
        return;
      }
      try {
        const image = await uploadImage(file);
        if (savedSelectionRef.current) {
          tiptap.view.dispatch(tiptap.state.tr.setSelection(savedSelectionRef.current));
        }
        tiptap
          .chain()
          .focus()
          .insertImageBlock({
            imageId: image.imageId,
            src: image.publicUrl || image.url,
            filename: image.filename,
            mimeType: image.mimeType,
            size: image.size,
            naturalWidth: image.width,
            naturalHeight: image.height,
            width: image.width,
            height: image.height,
            alt: image.filename,
          })
          .run();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "图片上传失败");
      }
    },
    [message, tiptap, uploadImage],
  );

  const handleInsertCard = (id: InsertCardId, options?: InsertCardOptions) => {
    if (!tiptap) return;
    setOpenId(null);
    if (id === "image") {
      savedSelectionRef.current = tiptap.state.selection;
      imageInputRef.current?.click();
      return;
    }
    runInsertCard(tiptap, id, options);
  };

  /* ---------------- 颜色 ---------------- */
  const applyTextColor = (color: string | null) => {
    if (!tiptap) return;
    if (color) {
      setTextColor(color);
      tiptap.chain().focus().setColor(color).run();
    } else {
      tiptap.chain().focus().unsetColor().run();
    }
  };

  const applyBgColor = (color: string | null) => {
    if (!tiptap) return;
    if (color) {
      setBgColor(color);
      tiptap.chain().focus().setHighlight({ color }).run();
    } else {
      tiptap.chain().focus().unsetHighlight().run();
    }
  };

  const runCleanup = (action: EditorCleanupActionKey) => {
    const result = runEditorCleanupAction(tiptap, action);
    const messages = CLEANUP_MESSAGES[action];
    if (result.changed) message.success(messages.success(result.affectedCount));
    else message.info(messages.unchanged);
  };

  const chain = () => tiptap!.chain().focus();
  const supActive = tiptap ? selectionContainsMark(tiptap, "superscript") : false;
  const subActive = tiptap ? selectionContainsMark(tiptap, "subscript") : false;
  const moreMarkActive = supActive || subActive || toolbarState.marks.code;
  const currentTextColor = (tiptap?.getAttributes("textStyle").color as string | undefined) ?? null;
  const currentBgColor = (tiptap?.getAttributes("highlight").color as string | undefined) ?? null;
  const headingLabel = HEADING_ITEMS.find((item) => item.level === toolbarState.headingLevel)?.label ?? "正文";
  const alignIcon = ALIGN_ITEMS.find((item) => item.key === toolbarState.textAlign)?.icon ?? "t-alignment-left";

  /* ---------------- 控件工厂 ---------------- */
  const dropdownProps = (id: string) => ({
    open: openId === id,
    onOpenChange: (open: boolean) => {
      if (open && tiptap) savedSelectionRef.current = tiptap.state.selection;
      setOpenId(open ? id : null);
    },
    trigger: ["click"] as ("click")[],
    placement: "bottomLeft" as const,
    align: { offset: [0, 4] as [number, number] },
    disabled: !editorReady,
    classNames: { root: "yq-overlay" },
  });

  const closeAndRun = (fn: () => void) => () => {
    setOpenId(null);
    fn();
  };

  const button = (
    id: string,
    icon: YuqueIconName | ReactNode,
    title: string,
    onClick: () => void,
    options: { shortcut?: string; active?: boolean; disabled?: boolean; onDoubleClick?: () => void } = {},
  ): Widget => ({
    id,
    kind: "button",
    render: () => (
      <TbTooltip title={title} shortcut={options.shortcut}>
        <button
          type="button"
          className={`yq-tb-btn${options.active ? " is-checked" : ""}`}
          disabled={!editorReady || options.disabled}
          aria-label={title}
          data-testid={`toolbar-${id}`}
          onMouseDown={preventMouseDown}
          onClick={onClick}
          onDoubleClick={options.onDoubleClick}
        >
          {typeof icon === "string" ? <YuqueIcon name={icon as YuqueIconName} /> : icon}
        </button>
      </TbTooltip>
    ),
  });

  const arrowButton = (
    id: string,
    icon: YuqueIconName | ReactNode,
    title: string,
    overlay: () => ReactNode,
    options: { shortcut?: string; active?: boolean } = {},
  ): Widget => ({
    id,
    kind: "arrow",
    render: () => (
      <Dropdown {...dropdownProps(id)} popupRender={() => <div onMouseDown={preventMouseDown}>{overlay()}</div>}>
        <span className="yq-tb-widget-wrap">
          <TbTooltip title={title} shortcut={options.shortcut} hidden={openId === id}>
            <button
              type="button"
              className={`yq-tb-arrow${options.active ? " is-checked" : ""}${openId === id ? " is-open" : ""}`}
              disabled={!editorReady}
              aria-label={title}
              data-testid={`toolbar-${id}`}
              onMouseDown={preventMouseDown}
            >
              <span className="yq-tb-arrow__icon">
                {typeof icon === "string" ? <YuqueIcon name={icon as YuqueIconName} /> : icon}
              </span>
              <ArrowDown />
            </button>
          </TbTooltip>
        </span>
      </Dropdown>
    ),
  });

  const selectButton = (id: string, value: string, title: string, overlay: () => ReactNode, shortcut?: string): Widget => ({
    id,
    kind: "select",
    render: () => (
      <Dropdown {...dropdownProps(id)} popupRender={() => <div onMouseDown={preventMouseDown}>{overlay()}</div>}>
        <span className="yq-tb-widget-wrap">
          <TbTooltip title={title} shortcut={shortcut} hidden={openId === id}>
            <button
              type="button"
              className={`yq-tb-select${openId === id ? " is-open" : ""}`}
              disabled={!editorReady}
              aria-label={title}
              data-testid={`toolbar-${id}`}
              onMouseDown={preventMouseDown}
            >
              <span className="yq-tb-select__value">{value}</span>
              <ArrowDown />
            </button>
          </TbTooltip>
        </span>
      </Dropdown>
    ),
  });

  /** 分体按钮：左侧执行，右侧箭头展开（有序列表 / 字体颜色 / 背景颜色 / 代码清理） */
  const splitButton = (
    id: string,
    kind: "split" | "color",
    icon: ReactNode,
    title: string,
    onApply: () => void,
    overlay: () => ReactNode,
    options: { shortcut?: string; active?: boolean } = {},
  ): Widget => ({
    id,
    kind,
    render: () => (
      <Dropdown {...dropdownProps(id)} popupRender={() => <div onMouseDown={preventMouseDown}>{overlay()}</div>}>
        <div
          className={`yq-tb-split yq-tb-split--${kind}${options.active ? " is-checked" : ""}${openId === id ? " is-open" : ""}`}
          data-testid={`toolbar-${id}`}
        >
          <TbTooltip title={title} shortcut={options.shortcut} hidden={openId === id}>
            <button
              type="button"
              className="yq-tb-split__main"
              disabled={!editorReady}
              aria-label={title}
              onMouseDown={preventMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                onApply();
              }}
            >
              {icon}
            </button>
          </TbTooltip>
          <TbTooltip title={title} shortcut={options.shortcut} hidden={openId === id}>
            <button
              type="button"
              className="yq-tb-split__arrow"
              disabled={!editorReady}
              aria-label={`${title}选项`}
              onMouseDown={preventMouseDown}
            >
              <ArrowDown />
            </button>
          </TbTooltip>
        </div>
      </Dropdown>
    ),
  });

  const divider = (id: string): Widget => ({ id, kind: "divider", render: () => <div className="yq-tb-divider" /> });

  /* ---------------- 下拉面板 ---------------- */
  const headingMenu = () => (
    <div className="yq-menu yq-select-menu">
      {HEADING_ITEMS.map((item) => (
        <div
          key={item.level}
          className={`yq-select-item${toolbarState.headingLevel === item.level ? " is-selected" : ""}`}
          onClick={closeAndRun(() =>
            item.level === 0
              ? chain().setParagraph().run()
              : chain().setHeading({ level: item.level as 1 | 2 | 3 | 4 | 5 | 6 }).run(),
          )}
        >
          <span className="yq-select-item__check">
            <YuqueIcon name="check" />
          </span>
          <span className="yq-select-item__label">
            <span className={item.className}>{item.label}</span>
            <span className="yq-select-item__shortcut">{kbd("Alt", "Mod", String(item.level))}</span>
          </span>
        </div>
      ))}
    </div>
  );

  const fontSizeMenu = () => (
    <div className="yq-menu yq-select-menu yq-select-menu--fontsize">
      {FONT_SIZES.map((size) => (
        <div
          key={size}
          className={`yq-select-item${toolbarState.fontSize === size ? " is-selected" : ""}`}
          onClick={closeAndRun(() => chain().setFontSize(size.replace("px", "")).run())}
        >
          <span className="yq-select-item__check">
            <YuqueIcon name="check" />
          </span>
          <span className="yq-select-item__label">{size}</span>
        </div>
      ))}
    </div>
  );

  const iconMenu = (items: Array<{ key: string; icon: YuqueIconName; label: string; active?: boolean; onClick: () => void }>) => (
    <div className="yq-menu yq-icon-menu">
      {items.map((item) => (
        <div key={item.key} className={`yq-menu-item${item.active ? " is-active" : ""}`} onClick={closeAndRun(item.onClick)}>
          <YuqueIcon name={item.icon} className="yq-menu-item__icon" />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );

  const lineHeightMenu = () => (
    <div className="yq-menu yq-check-menu">
      {LINE_HEIGHTS.map((item) => (
        <div
          key={item.key || "default"}
          className="yq-menu-item"
          onClick={closeAndRun(() =>
            item.key ? chain().setLineHeight(item.key).run() : chain().unsetLineHeight().run(),
          )}
        >
          {toolbarState.lineHeight === item.key && <YuqueIcon name="check" className="yq-check-menu__checked" />}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );

  const alignMenu = () => (
    <div className="yq-inline-menu">
      {ALIGN_ITEMS.map((item) => (
        <TbTooltip key={item.key} title={item.label}>
          <div
            className={`yq-inline-menu__btn${toolbarState.textAlign === item.key ? " is-selected" : ""}`}
            onClick={closeAndRun(() => chain().setTextAlign(item.key).run())}
          >
            <YuqueIcon name={item.icon} />
          </div>
        </TbTooltip>
      ))}
    </div>
  );

  const listStyleMenu = () => (
    <div className="yq-list-type-selector">
      {LIST_STYLE_CARDS.map((card) => (
        <ul
          key={card.key}
          title={card.label}
          className={toolbarState.nodes.orderedList && toolbarState.orderedListType === card.key ? "is-active" : ""}
          onClick={closeAndRun(() => {
            const c = chain();
            if (!tiptap!.isActive("orderedList")) c.toggleOrderedList();
            c.setOrderedListStyle(card.key).run();
          })}
        >
          {card.preview.map(([level, symbol], index) => (
            <li key={index}>
              <span className="yq-list-type-selector__symbol" data-level={level}>
                {symbol}
              </span>
              <span className="yq-list-type-selector__line" />
            </li>
          ))}
        </ul>
      ))}
    </div>
  );

  const cleanupMenu = () => (
    <div className="yq-menu yq-check-menu">
      {codeCleanupItems.map((item) =>
        isCodeCleanupActionItem(item) ? (
          <div
            key={item.key}
            className="yq-menu-item"
            onClick={closeAndRun(() => {
              setCleanupAction(item.key);
              runCleanup(item.key);
            })}
          >
            {cleanupAction === item.key && <YuqueIcon name="check" className="yq-check-menu__checked" />}
            <span>{item.label}</span>
          </div>
        ) : (
          <div key={item.key} className="yq-menu-divider" />
        ),
      )}
    </div>
  );

  /* ---------------- 控件列表（语雀 DEFAULT_TOOLBAR 顺序） ---------------- */
  const has = (id: string) => !enabledItemIds || enabledItemIds.has(id);
  const showInsert =
    variant === "fixed" &&
    (!enabledItemIds || ["image", "table", "code-block", "highlight-block"].some((id) => enabledItemIds.has(id)));

  const allWidgets: Widget[] = [
    ...(showInsert
      ? [
          {
            id: "insert",
            kind: "insert" as const,
            render: () => (
              <Dropdown
                {...dropdownProps("insert")}
                destroyOnHidden
                align={{ offset: [-4, 5] }}
                popupRender={() => (
                  <BlockInsertPanel searchable className="yq-insert-panel--toolbar" onSelect={handleInsertCard} />
                )}
              >
                <span className="yq-tb-widget-wrap">
                  <TbTooltip title="插入" hidden={openId === "insert"}>
                    <button
                      type="button"
                      className={`yq-tb-insert${openId === "insert" ? " is-open" : ""}`}
                      disabled={!editorReady}
                      aria-label="插入"
                      data-testid="toolbar-insert"
                      onMouseDown={preventMouseDown}
                    >
                      <YuqueIcon name="t-insert-card" />
                    </button>
                  </TbTooltip>
                </span>
              </Dropdown>
            ),
          },
          divider("d-insert"),
        ]
      : []),
    ...(has("undo") ? [button("undo", "EditorUndo", "撤销", () => chain().undo().run(), { shortcut: kbd("Mod", "Z"), disabled: !safeCan(tiptap, "undo") })] : []),
    ...(has("redo") ? [button("redo", "EditorRedo", "重做", () => chain().redo().run(), { shortcut: kbd("Shift", "Mod", "Z"), disabled: !safeCan(tiptap, "redo") })] : []),
    ...(has("format-painter")
      ? [
          button("format-painter", "EditorFormatPainter", "格式刷", () => startPainter(false), {
            active: Boolean(painter),
            onDoubleClick: () => startPainter(true),
          }),
        ]
      : []),
    ...(has("clearFormat") ? [button("clearFormat", "EditorClearFormat", "清除格式", () => chain().unsetAllMarks().run())] : []),
    divider("d-history"),
    ...(has("text-mode") ? [selectButton("text-mode", headingLabel, "正文与标题", headingMenu)] : []),
    ...(has("font-size") ? [selectButton("font-size", toolbarState.fontSize, "字号调整", fontSizeMenu)] : []),
    ...(has("bold") ? [button("bold", "t-bold", "粗体", () => runInlineMarkCommand(tiptap, "bold"), { shortcut: kbd("Mod", "B"), active: toolbarState.marks.bold })] : []),
    ...(has("italic") ? [button("italic", "t-italic", "斜体", () => runInlineMarkCommand(tiptap, "italic"), { shortcut: kbd("Mod", "I"), active: toolbarState.marks.italic })] : []),
    ...(has("strike") ? [button("strike", "t-strikethrough", "删除线", () => runInlineMarkCommand(tiptap, "strike"), { shortcut: kbd("Shift", "Mod", "S"), active: toolbarState.marks.strike })] : []),
    ...(has("underline") ? [button("underline", "t-underline", "下划线", () => runInlineMarkCommand(tiptap, "underline"), { shortcut: kbd("Mod", "U"), active: toolbarState.marks.underline })] : []),
    ...(has("more-mark")
      ? [
          arrowButton(
            "more-mark",
            "t-moremark",
            "更多文本样式",
            () =>
              iconMenu([
                { key: "sup", icon: "t-superscript", label: "上标", active: supActive, onClick: () => chain().toggleSuperscript().run() },
                { key: "sub", icon: "t-subscript", label: "下标", active: subActive, onClick: () => chain().toggleSubscript().run() },
                { key: "code", icon: "t-code", label: "行内代码", active: toolbarState.marks.code, onClick: () => runInlineMarkCommand(tiptap, "code") },
              ]),
            { active: moreMarkActive },
          ),
        ]
      : []),
    divider("d-mark"),
    ...(has("text-color")
      ? [
          splitButton(
            "text-color",
            "color",
            <YuqueIcon name="t-font-color" color={textColor} />,
            "字体颜色",
            () => applyTextColor(textColor),
            () => <ColorBoard kind="text" value={currentTextColor} onChange={(color) => { setOpenId(null); applyTextColor(color); }} />,
          ),
        ]
      : []),
    ...(has("bg-color")
      ? [
          splitButton(
            "bg-color",
            "color",
            <YuqueIcon name="t-bg-color" color={bgColor} />,
            "背景颜色",
            () => applyBgColor(bgColor),
            () => <ColorBoard kind="background" value={currentBgColor} onChange={(color) => { setOpenId(null); applyBgColor(color); }} />,
          ),
        ]
      : []),
    divider("d-color"),
    ...(has("text-align") ? [arrowButton("text-align", alignIcon, "对齐方式", alignMenu)] : []),
    ...(has("bullet-list") ? [button("bullet-list", "t-unorder-list", "无序列表", () => chain().toggleBulletList().run(), { shortcut: kbd("Shift", "Mod", "8"), active: toolbarState.nodes.bulletList })] : []),
    ...(has("ordered-list")
      ? [
          splitButton(
            "ordered-list",
            "split",
            <YuqueIcon name="t-order-list" />,
            "有序列表",
            () => chain().toggleOrderedList().run(),
            listStyleMenu,
            { shortcut: kbd("Shift", "Mod", "7"), active: toolbarState.nodes.orderedList },
          ),
        ]
      : []),
    ...(has("indent")
      ? [
          arrowButton("indent", "EditorIndent", "缩进调整", () =>
            iconMenu([
              { key: "indent", icon: "EditorIndent", label: "增加缩进", onClick: () => chain().indent().run() },
              { key: "outdent", icon: "EditorOutdent", label: "减少缩进", onClick: () => chain().outdent().run() },
            ]),
          ),
        ]
      : []),
    ...(has("line-height") ? [arrowButton("line-height", "EditorLineHeight", "行高调整", lineHeightMenu)] : []),
    divider("d-block"),
    ...(has("check-list") ? [button("check-list", "t-task-list", "任务列表", () => chain().toggleTaskList().run(), { shortcut: kbd("Shift", "Mod", "9"), active: toolbarState.nodes.taskList })] : []),
    ...(has("link") ? [button("link", "t-link", "插入链接", openLinkPopup, { active: toolbarState.marks.link })] : []),
    ...(has("blockquote") ? [button("blockquote", "t-quote", "插入引用", () => chain().toggleBlockquote().run(), { shortcut: kbd("Shift", "Mod", "B"), active: toolbarState.nodes.blockquote })] : []),
    ...(has("divider") ? [button("divider", "t-hr", "插入分割线", () => chain().setHorizontalRule().run())] : []),
    divider("d-extra"),
    ...(has("code-cleanup")
      ? [
          splitButton(
            "code-cleanup",
            "split",
            <CodeCleanupIcon />,
            "代码清理",
            () => runCleanup(cleanupAction),
            cleanupMenu,
          ),
        ]
      : []),
  ];

  const widgets = normalizeDividers(allWidgets);

  // 计算放得下的控件数量（只依赖控件 id/类型序列与可用宽度；渲染函数每次取最新的，避免闭包过期）
  const layoutKey = widgets.map((widget) => `${widget.id}:${widget.kind}`).join(",");
  const fitCount = useMemo(() => {
    const kinds = layoutKey.split(",").map((item) => item.split(":")[1] as WidgetKind);
    if (variant !== "fixed" || availableWidth === null) return kinds.length;
    let total = 0;
    let prev: WidgetKind | null = null;
    const offsets: number[] = [];
    for (const kind of kinds) {
      total += widgetMargin(prev, kind) + WIDGET_WIDTH[kind];
      offsets.push(total);
      prev = kind;
    }
    if (total <= availableWidth) return kinds.length;
    let count = 0;
    while (count < kinds.length && offsets[count] + MORE_WIDTH <= availableWidth) count += 1;
    return count;
  }, [availableWidth, layoutKey, variant]);
  const visible = normalizeDividers(widgets.slice(0, fitCount));
  const overflow = normalizeDividers(widgets.slice(fitCount));

  const renderRow = (list: Widget[]) => {
    let prev: WidgetKind | null = null;
    return list.map((widget) => {
      const marginLeft = widgetMargin(prev, widget.kind);
      prev = widget.kind;
      return (
        <div key={widget.id} className={`yq-tb-widget yq-tb-widget--${widget.kind}`} style={{ marginLeft }}>
          {widget.render()}
        </div>
      );
    });
  };

  return (
    <div ref={rootRef} className={`yq-toolbar yq-toolbar--${variant}`} data-testid={`yq-toolbar-${variant}`}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImageFile(file);
        }}
      />
      <div className="yq-toolbar__content">
        {renderRow(visible)}
        {overflow.length > 0 && (
          <div className="yq-tb-more">
            <Popover
              open={moreOpen}
              onOpenChange={setMoreOpen}
              trigger="click"
              placement="bottomRight"
              arrow={false}
              align={{ offset: [0, 4] }}
              classNames={{ root: "yq-overlay yq-tb-more-overlay" }}
              content={<div className="yq-tb-more-overlay__row" onMouseDown={preventMouseDown}>{renderRow(overflow)}</div>}
            >
              <span className="yq-tb-widget-wrap">
                <TbTooltip title="更多" hidden={moreOpen}>
                  <button
                    type="button"
                    className={`yq-tb-btn${moreOpen ? " is-checked" : ""}`}
                    aria-label="更多"
                    data-testid="toolbar-more"
                    onMouseDown={preventMouseDown}
                  >
                    <YuqueIcon name="MoreHorizontal" />
                  </button>
                </TbTooltip>
              </span>
            </Popover>
          </div>
        )}
      </div>

      {linkPopup && (
        <div className="link-picker-popup-overlay" style={{ position: "fixed", left: linkPopup.x, top: linkPopup.y, zIndex: 1000 }}>
          <LinkPickerPopup
            textValue={linkPopup.text}
            linkValue={linkPopup.url}
            onTextChange={(text) => setLinkPopup((current) => (current ? { ...current, text } : current))}
            onLinkChange={(url) => setLinkPopup((current) => (current ? { ...current, url } : current))}
            onConfirm={applyLink}
            onClose={() => setLinkPopup(null)}
          />
        </div>
      )}
    </div>
  );
}
