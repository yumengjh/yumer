import { useEffect, useState, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Dropdown, Tooltip, App, ColorPicker, Divider } from "antd";
import type { Editor } from "@tiptap/react";
import type { Selection } from "prosemirror-state";
import {
  UndoOutlined,
  RedoOutlined,
  ClearOutlined,
  EditOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CheckSquareOutlined,
  LinkOutlined,
  CodeOutlined,
  DownOutlined,
  BgColorsOutlined,
  TableOutlined,
  PictureOutlined,
  MinusOutlined,
  FormatPainterOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { useMarkdownEditorContext } from "../EditorContext";
import {
  titleLevelItems,
  fontSizeItems,
  codeLanguageItems,
  codeCleanupItems,
  orderedListTypeItems,
  lineHeightItems,
  highlightBlockColors,
  defaultHighlightBlockColor,
  defaultColor,
  solidColors,
  gradientColors,
} from "./data";
import TablePicker from "./TablePicker";
import LinkPickerPopup from "./LinkPickerPopup";
import SplitDropdown from "./SplitDropdown";
import {
  cleanupCodeBlocks,
  type CodeCleanupActionKey,
} from "../code/codeBlockCleanup";
import {
  getToolbarState,
  isToolbarItemActive,
  runInlineMarkCommand,
} from "./toolbarState";
import "./style.css";
import { uploadImage } from "@/services/images";

type ToolbarItem = {
  id: string;
  label: string;
  content: ReactNode;
  type?: "dropdown" | "color-picker" | "highlight-block-picker" | "indent-picker" | "table-picker" | "link-picker" | "format-painter" | "code-cleanup-picker";
};

function QuoteIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5 3.871 3.871 0 0 1-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5 3.871 3.871 0 0 1-2.748-1.179z" />
    </svg>
  );
}

function LineHeightIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function HighlightBlockIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity="0.15" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="14" y2="12" />
      <line x1="7" y1="16" x2="11" y2="16" />
    </svg>
  );
}

function IndentIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="4" x2="21" y2="4" />
      <line x1="11" y1="9" x2="21" y2="9" />
      <line x1="7" y1="14" x2="21" y2="14" />
      <line x1="11" y1="19" x2="21" y2="19" />
    </svg>
  );
}

function OutdentIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="4" x2="21" y2="4" />
      <line x1="3" y1="9" x2="13" y2="9" />
      <line x1="3" y1="14" x2="17" y2="14" />
      <line x1="3" y1="19" x2="13" y2="19" />
    </svg>
  );
}

export default function DesktopToolbar() {
  const { message } = App.useApp();
  const { editor, defaultFontSize, workspaceId } = useMarkdownEditorContext();
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  const [linkTextValue, setLinkTextValue] = useState("");
  const [linkUrlValue, setLinkUrlValue] = useState("");
  const [linkPopupPos, setLinkPopupPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedColor, setSelectedColor] = useState(defaultColor);
  const [selectedBgColor, setSelectedBgColor] = useState("#FFFF00");
  const [lastTableSize, setLastTableSize] = useState({ rows: 3, cols: 3 });
  const tiptap = editor as Editor | null;
  const toolbarState = getToolbarState(tiptap, { defaultFontSize });
  const editorReady = Boolean(tiptap);
  const [, forceUpdate] = useState(0);
  const savedSelectionRef = useRef<Selection | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [tooltipOpen, setTooltipOpen] = useState<Record<string, boolean>>({});
  const [copiedMarks, setCopiedMarks] = useState<Array<{ type: string; attrs?: Record<string, any> }>>([]);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [lastHighlightColor, setLastHighlightColor] = useState(defaultHighlightBlockColor);
  const [lastIndentAction, setLastIndentAction] = useState<"indent" | "outdent">("indent");
  const [defaultCodeCleanupAction, setDefaultCodeCleanupAction] = useState<CodeCleanupActionKey>(
    "removeTrailingBlankLines",
  );

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

  const openLinkPopup = () => {
    if (!tiptap) return;

    // 保存选区
    savedSelectionRef.current = tiptap.state.selection;

    const { from, to } = tiptap.state.selection;
    const selectedText = tiptap.state.doc.textBetween(from, to);
    const existingLink = tiptap.getAttributes("link");

    // 获取光标位置
    const { view } = tiptap;
    const coords = view.coordsAtPos(from);

    setLinkTextValue(selectedText || "");
    setLinkUrlValue(existingLink.href || "");
    setLinkPopupPos({ x: coords.left, y: coords.bottom + 8 });
    setLinkPopupOpen(true);
  };

  const applyLinkFromPopup = () => {
    if (!tiptap) return;
    const url = linkUrlValue.trim();
    const text = linkTextValue.trim();

    // 恢复选区
    if (savedSelectionRef.current) {
      const { view } = tiptap;
      view.dispatch(view.state.tr.setSelection(savedSelectionRef.current));
    }

    if (!url) {
      // URL 为空，移除链接
      tiptap.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = url.match(/^https?:\/\//) ? url : `https://${url}`;

      // 转义 HTML 特殊字符
      const escapeHtml = (str: string) =>
        str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      // 如果有文本且文本不同于选中文本，删除选区并插入新内容
      const { from, to } = tiptap.state.selection;
      const currentSelectedText = tiptap.state.doc.textBetween(from, to);

      if (text && text !== currentSelectedText) {
        tiptap
          .chain()
          .focus()
          .deleteSelection()
          .insertContent(`<a href="${escapeHtml(href)}" class="tiptap-link">${escapeHtml(text)}</a>`)
          .run();
      } else {
        tiptap.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    }

    setLinkPopupOpen(false);
    setLinkTextValue("");
    setLinkUrlValue("");
  };

  const handleClick = (id: string) => () => {
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
      case "blockquote":
        tiptap.chain().focus().toggleBlockquote().run();
        break;
      case "code-block":
        tiptap.chain().focus().toggleCodeBlock().run();
        break;
      case "divider":
        tiptap.chain().focus().setHorizontalRule().run();
        break;
      case "image":
        savedSelectionRef.current = tiptap.state.selection;
        imageInputRef.current?.click();
        break;
      default:
        break;
    }
  };

  const handleImageFileSelect = useCallback(
    async (file: File) => {
      if (!tiptap) return;
      if (!workspaceId) {
        message.error("未选择工作空间");
        return;
      }
      try {
        const image = await uploadImage(workspaceId, file);
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
    [message, tiptap, workspaceId],
  );

  const getCurrentHeadingKey = (): string => {
    return `${toolbarState.headingLevel}`;
  };

  const getCurrentCodeLanguage = (): string => {
    return toolbarState.codeLanguage;
  };

  const dropdownHandlers: Record<string, (key: string) => void> = {
    "text-mode": (key: string) => {
      if (!tiptap) return;
      const level = Number(key);
      if (level === 0) {
        tiptap.chain().focus().setParagraph().run();
      } else if (level >= 1 && level <= 6) {
        tiptap
          .chain()
          .focus()
          .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
          .run();
      }
    },
    "font-size": (key: string) => {
      if (!tiptap) return;
      const size = key.replace("px", "");
      tiptap.chain().focus().setFontSize(size).run();
    },
    "text-align": (key: string) => {
      if (!tiptap) return;
      tiptap
        .chain()
        .focus()
        .setTextAlign(key as "left" | "center" | "right" | "justify")
        .run();
    },
    "ordered-list": (key: string) => {
      if (!tiptap) return;
      if (!tiptap.isActive("orderedList")) {
        tiptap.chain().focus().toggleOrderedList().run();
      }
      tiptap.chain().focus().setOrderedListStyle(key).run();
    },
    "code-language": (key: string) => {
      if (!tiptap) return;
      if (!tiptap.isActive("codeBlock")) {
        tiptap.chain().focus().setCodeBlock({ language: key }).run();
        return;
      }
      tiptap.chain().focus().updateAttributes("codeBlock", { language: key }).run();
    },
    "line-height": (key: string) => {
      if (!tiptap) return;
      if (!key) {
        tiptap.chain().focus().unsetLineHeight().run();
      } else {
        tiptap.chain().focus().setLineHeight(key).run();
      }
    },
  };

  const handleColorSelect = useCallback(
    (color: string) => {
      if (!tiptap) return;
      setSelectedColor(color);
      const { view } = tiptap;
      if (savedSelectionRef.current) {
        const sel = savedSelectionRef.current;
        view.dispatch(view.state.tr.setSelection(sel));
      }
      view.focus();
      tiptap.chain().setColor(color).run();
    },
    [tiptap],
  );

  const handleBgColorSelect = useCallback(
    (color: string) => {
      if (!tiptap) return;
      setSelectedBgColor(color);
      const { view } = tiptap;
      if (savedSelectionRef.current) {
        const sel = savedSelectionRef.current;
        view.dispatch(view.state.tr.setSelection(sel));
      }
      view.focus();
      tiptap.chain().toggleHighlight({ color }).run();
    },
    [tiptap],
  );

  // 格式刷：加样式 - 复制选区格式到格式刷
  const handleCopyStyle = useCallback(() => {
    if (!tiptap) return;
    const { from, to } = tiptap.state.selection;
    const marks: Array<{ type: string; attrs?: Record<string, any> }> = [];

    tiptap.state.doc.nodesBetween(from, to, (node) => {
      if (node.marks) {
        node.marks.forEach((mark) => {
          if (!marks.some((m) => m.type === mark.type.name)) {
            marks.push({ type: mark.type.name, attrs: { ...mark.attrs } });
          }
        });
      }
    });

    setCopiedMarks(marks);
    message.success(marks.length > 0 ? `已复制 ${marks.length} 个格式` : "选区无格式");
  }, [tiptap]);

  // 格式刷：删除样式 - 清空格式刷
  const handleClearCopiedStyle = useCallback(() => {
    setCopiedMarks([]);
    message.info("已清空格式刷");
  }, []);

  // 格式刷：应用样式 - 将格式刷格式应用到选区
  const handleApplyStyle = useCallback(() => {
    if (!tiptap || copiedMarks.length === 0) return;

    copiedMarks.forEach(({ type, attrs }) => {
      const isActive = tiptap.isActive(type, attrs);

      switch (type) {
        case "bold":
          if (!isActive) tiptap.chain().focus().toggleBold().run();
          break;
        case "italic":
          if (!isActive) tiptap.chain().focus().toggleItalic().run();
          break;
        case "strike":
          if (!isActive) tiptap.chain().focus().toggleStrike().run();
          break;
        case "underline":
          if (!isActive) tiptap.chain().focus().toggleUnderline().run();
          break;
        case "code":
          if (!isActive) tiptap.chain().focus().toggleCode().run();
          break;
        case "highlight":
          if (!isActive) tiptap.chain().focus().toggleHighlight({ color: attrs?.color }).run();
          break;
        case "textStyle":
          // 处理字体颜色
          if (attrs?.color && !tiptap.isActive("textStyle", { color: attrs.color })) {
            tiptap.chain().focus().setColor(attrs.color).run();
          }
          // 处理字体大小
          if (attrs?.fontSize) {
            tiptap.chain().focus().setFontSize(attrs.fontSize).run();
          }
          break;
      }
    });

    message.success("已应用格式");
  }, [tiptap, copiedMarks]);

  const handleGradientSelect = (gradientId: string) => {
    message.info(`渐变色选择功能暂未实现。选择的渐变: ${gradientId}`);
  };

  const handleTableInsert = useCallback(
    (rows: number, cols: number) => {
      if (!tiptap) return;
      setLastTableSize({ rows, cols });
      tiptap
        .chain()
        .focus()
        .insertTable({ rows, cols, withHeaderRow: true })
        .run();
    },
    [tiptap, setLastTableSize],
  );

  const runCodeCleanupAction = useCallback(
    (action: CodeCleanupActionKey) => {
      const result = cleanupCodeBlocks(tiptap, action);
      const messages: Record<
        CodeCleanupActionKey,
        {
          success: (count: number) => string;
          unchanged: string;
        }
      > = {
        removeTrailingBlankLines: {
          success: (count) => `??? ${count} ?????????`,
          unchanged: "???????????????",
        },
        removeEmptyCodeBlocks: {
          success: (count) => `??? ${count} ?????`,
          unchanged: "???????",
        },
        collapseStatusBars: {
          success: (count) => `??? ${count} ????????`,
          unchanged: "???????????",
        },
        expandStatusBars: {
          success: (count) => `??? ${count} ????????`,
          unchanged: "???????????",
        },
        enableLineNumbers: {
          success: (count) => `??? ${count} ???????`,
          unchanged: "??????????",
        },
        disableLineNumbers: {
          success: (count) => `??? ${count} ???????`,
          unchanged: "??????????",
        },
      };

      const actionMessages = messages[action];
      if (result.changed) {
        message.success(actionMessages.success(result.affectedCount));
      } else {
        message.info(actionMessages.unchanged);
      }
    },
    [message, tiptap],
  );

  const isActive = (id: string): boolean => {
    return isToolbarItemActive(toolbarState, id);
  };

  const getCurrentHeadingLevel = (): string => {
    return toolbarState.headingLevel > 0 ? `标题 ${toolbarState.headingLevel}` : "正文";
  };

  const getCurrentFontSize = (): string => {
    return toolbarState.fontSize;
  };

  const alignItems = [
    { key: "left", label: "左对齐", icon: <AlignLeftOutlined /> },
    { key: "center", label: "居中", icon: <AlignCenterOutlined /> },
    { key: "right", label: "右对齐", icon: <AlignRightOutlined /> },
    {
      key: "justify",
      label: "两端对齐",
      icon: <AlignLeftOutlined style={{ transform: "scaleX(-1)" }} />,
    },
  ].map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
  }));

  const getCurrentAlignment = (): { label: string; icon: ReactNode; key: string } => {
    const align = toolbarState.textAlign;
    const alignMap: Record<string, { label: string; icon: ReactNode }> = {
      left: { label: "左对齐", icon: <AlignLeftOutlined /> },
      center: { label: "居中", icon: <AlignCenterOutlined /> },
      right: { label: "右对齐", icon: <AlignRightOutlined /> },
      justify: {
        label: "两端对齐",
        icon: <AlignLeftOutlined style={{ transform: "scaleX(-1)" }} />,
      },
    };
    return { ...(alignMap[align] || alignMap.left), key: align };
  };

  const getCurrentOrderedListType = (): string => {
    return toolbarState.orderedListType;
  };

  const getCurrentLineHeight = (): string => {
    return toolbarState.lineHeight;
  };

  const toolbarGroups: ToolbarItem[][] = [
    [
      { id: "undo", label: "撤销", content: <UndoOutlined /> },
      { id: "redo", label: "重做", content: <RedoOutlined /> },
      { id: "clearFormat", label: "清除格式", content: <ClearOutlined /> },
      { id: "format-painter", label: "格式刷", content: <FormatPainterOutlined />, type: "format-painter" },
    ],
    [{ id: "cursor", label: "光标", content: <EditOutlined /> }],
    [
      {
        id: "text-mode",
        label: "标题",
        content: <span className="text-label heading-text">{getCurrentHeadingLevel()}</span>,
        type: "dropdown",
      },
      {
        id: "font-size",
        label: "字号",
        content: <span className="text-label">{getCurrentFontSize()}</span>,
        type: "dropdown",
      },
      {
        id: "code-cleanup",
        label: "\u4ee3\u7801\u6e05\u7406",
        content: <ClearOutlined />,
        type: "code-cleanup-picker",
      },
    ],
    [
      { id: "bold", label: "加粗", content: <BoldOutlined /> },
      { id: "italic", label: "斜体", content: <ItalicOutlined /> },
      { id: "strike", label: "删除线", content: <StrikethroughOutlined /> },
      { id: "underline", label: "下划线", content: <UnderlineOutlined /> },
    ],
    [
      {
        id: "text-color",
        label: "文字颜色",
        content: (
          <span className="color-icon-wrap">
            <EditOutlined />
            <span className="color-icon-indicator" style={{ backgroundColor: selectedColor }} />
          </span>
        ),
        type: "color-picker",
      },
      {
        id: "bg-color",
        label: "背景颜色",
        content: (
          <span className="color-icon-wrap">
            <BgColorsOutlined />
            <span className="color-icon-indicator" style={{ backgroundColor: selectedBgColor }} />
          </span>
        ),
        type: "color-picker",
      },
    ],
    [
      {
        id: "highlight-block",
        label: "高亮块",
        content: (
          <span className="color-icon-wrap">
            <HighlightBlockIcon />
            <span className="color-icon-indicator" style={{ backgroundColor: lastHighlightColor }} />
          </span>
        ),
        type: "highlight-block-picker",
      },
    ],
    [
      {
        id: "text-align",
        label: "对齐",
        content: <span className="dropdown-icon-text">{getCurrentAlignment().icon}</span>,
        type: "dropdown",
      },
    ],
    [
      {
        id: "line-height",
        label: "行高",
        content: <LineHeightIcon />,
        type: "dropdown",
      },
    ],
    [
      {
        id: "indent",
        label: "缩进",
        content: <IndentIcon />,
        type: "indent-picker",
      },
    ],
    [
      { id: "bullet-list", label: "无序列表", content: <UnorderedListOutlined /> },
      {
        id: "ordered-list",
        label: "有序列表",
        content: (
          <span className="dropdown-icon-text">
            <OrderedListOutlined />
            <span className="text-label">
              {orderedListTypeItems.find((item) => item.key === getCurrentOrderedListType())
                ?.label || "1."}
            </span>
          </span>
        ),
        type: "dropdown",
      },
      { id: "check-list", label: "待办列表", content: <CheckSquareOutlined /> },
    ],
    [
      { id: "blockquote", label: "引用", content: <QuoteIcon /> },
      { id: "divider", label: "分割线", content: <MinusOutlined /> },
      { id: "image", label: "图片", content: <PictureOutlined /> },
      {
        id: "code-language",
        label: "代码语言",
        content: <CodeOutlined />,
        type: "dropdown",
      },
      { id: "link", label: "链接", content: <LinkOutlined />, type: "link-picker" },
      { id: "table", label: "表格", content: <TableOutlined />, type: "dropdown" },
    ],
  ];

  return (
    <div className="toolbar">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImageFileSelect(file);
        }}
      />
      {toolbarGroups.map((group, index) => (
        <div className="toolbar-group" key={`toolbar-group-${index}`}>
          {group.map((item) =>
            item.type === "code-cleanup-picker" ? (
              <SplitDropdown
                key={item.id}
                content={item.content}
                label={item.label}
                disabled={!editorReady}
                open={openDropdown === item.id}
                onOpenChange={(open) => {
                  setOpenDropdown(open ? item.id : null);
                }}
                onApply={() => {
                  runCodeCleanupAction(defaultCodeCleanupAction);
                }}
                dropdownContent={
                  <div className="ant-dropdown-menu" style={{ borderRadius: "4px", border: "1px solid var(--app-border)", boxShadow: "none" }}>
                    {codeCleanupItems.map((cleanupItem) => {
                      if ("type" in cleanupItem && cleanupItem.type === "divider") {
                        return <div key={cleanupItem.key} className="ant-dropdown-menu-item-divider" />;
                      }

                      const active = cleanupItem.key === defaultCodeCleanupAction;
                      return (
                        <div
                          key={cleanupItem.key}
                          className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
                          onClick={() => {
                            setDefaultCodeCleanupAction(cleanupItem.key);
                            runCodeCleanupAction(cleanupItem.key);
                            setOpenDropdown(null);
                          }}
                        >
                          <span className="menu-check-mark">{active ? "✓" : ""}</span>
                          {cleanupItem.label}
                        </div>
                      );
                    })}
                  </div>
                }
              />
            ) : item.type === "dropdown" ? (
              <SplitDropdown
                key={item.id}
                content={item.content}
                label={item.label}
                disabled={!editorReady}
                active={isActive(item.id)}
                overlayClassName={item.id === "text-align" ? "align-dropdown" : undefined}
                open={openDropdown === item.id}
                onOpenChange={(open) => {
                  setOpenDropdown(open ? item.id : null);
                }}
                onApply={() => {
                  // 左侧按钮点击：应用当前/上次选择的功能
                  let lastValue = "";
                  switch (item.id) {
                    case "text-mode": {
                      const handler = dropdownHandlers[item.id];
                      if (handler) {
                        lastValue = getCurrentHeadingKey();
                        if (lastValue === "0") {
                          handler("1");
                        } else {
                          handler(lastValue);
                        }
                      }
                      break;
                    }
                    case "font-size": {
                      const handler = dropdownHandlers[item.id];
                      if (handler) {
                        lastValue = getCurrentFontSize();
                        handler(lastValue);
                      }
                      break;
                    }
                    case "text-align": {
                      const handler = dropdownHandlers[item.id];
                      if (handler) {
                        lastValue = getCurrentAlignment().key;
                        handler(lastValue);
                      }
                      break;
                    }
                    case "ordered-list": {
                      const handler = dropdownHandlers[item.id];
                      if (handler && !tiptap?.isActive("orderedList")) {
                        handler(getCurrentOrderedListType());
                      }
                      break;
                    }
                    case "code-language": {
                      const handler = dropdownHandlers[item.id];
                      if (handler) {
                        lastValue = getCurrentCodeLanguage();
                        handler(lastValue);
                      }
                      break;
                    }
                    case "line-height": {
                      const handler = dropdownHandlers[item.id];
                      if (handler) {
                        lastValue = getCurrentLineHeight();
                        if (lastValue) {
                          handler(lastValue);
                        } else {
                          handler("1.5");
                        }
                      }
                      break;
                    }
                    case "table":
                      handleTableInsert(lastTableSize.rows, lastTableSize.cols);
                      break;
                    default:
                      break;
                  }
                }}
                dropdownContent={
                  item.id === "text-align" ? (
                    <div className="align-menu-panel">
                      <div className="align-menu-row">
                        {alignItems.map((alignItem) => {
                          const active = alignItem.key === getCurrentAlignment().key;
                          return (
                            <Tooltip key={alignItem.key} title={alignItem.label} placement="bottom">
                              <button
                                type="button"
                                className={active ? "align-menu-btn is-active" : "align-menu-btn"}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  dropdownHandlers["text-align"]?.(alignItem.key);
                                  setOpenDropdown(null);
                                }}
                              >
                                {alignItem.icon}
                              </button>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  ) : item.id === "table" ? (
                    <TablePicker
                      onSelect={(rows, cols) => {
                        handleTableInsert(rows, cols);
                        setOpenDropdown(null);
                      }}
                    />
                  ) : (
                    <div className="ant-dropdown-menu" style={{ borderRadius: "4px", border: "1px solid var(--app-border)", boxShadow: "none" }}>
                      {item.id === "text-mode" &&
                        titleLevelItems.map((levelItem) => {
                          const active = levelItem.key === getCurrentHeadingKey();
                          return (
                            <div
                              key={levelItem.key}
                              className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
                              onClick={() => {
                                dropdownHandlers["text-mode"]?.(levelItem.key);
                                setOpenDropdown(null);
                              }}
                            >
                              <div className="heading-menu-item">
                                <div className="heading-menu-left">
                                  <span className="heading-menu-check">{active ? "✓" : ""}</span>
                                  <span
                                    className={
                                      levelItem.key === "0"
                                        ? "heading-menu-label is-body"
                                        : `heading-menu-label is-${levelItem.size}`
                                    }
                                  >
                                    {levelItem.label}
                                  </span>
                                </div>
                                <div className="heading-menu-shortcut">{levelItem.shortcut}</div>
                              </div>
                            </div>
                          );
                        })}
                      {item.id === "font-size" &&
                        fontSizeItems.map((sizeItem) => {
                          const active = sizeItem.key === getCurrentFontSize();
                          return (
                            <div
                              key={sizeItem.key}
                              className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
                              onClick={() => {
                                dropdownHandlers["font-size"]?.(sizeItem.key);
                                setOpenDropdown(null);
                              }}
                            >
                              <div className="font-size-menu-item">
                                <span className="font-size-menu-check">{active ? "✓" : ""}</span>
                                <span className="font-size-menu-label">{sizeItem.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      {item.id === "ordered-list" &&
                        orderedListTypeItems.map((listItem) => {
                          const active = listItem.key === getCurrentOrderedListType();
                          return (
                            <div
                              key={listItem.key}
                              className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
                              onClick={() => {
                                dropdownHandlers["ordered-list"]?.(listItem.key);
                                setOpenDropdown(null);
                              }}
                            >
                              <span className="menu-check-mark">{active ? "✓ " : ""}</span>
                              {listItem.label}
                            </div>
                          );
                        })}
                      {item.id === "code-language" &&
                        codeLanguageItems.map((langItem) => {
                          const active = langItem.key === getCurrentCodeLanguage();
                          return (
                            <div
                              key={langItem.key}
                              className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
                              onClick={() => {
                                dropdownHandlers["code-language"]?.(langItem.key);
                                setOpenDropdown(null);
                              }}
                            >
                              <span className="menu-check-mark">{active ? "✓ " : ""}</span>
                              {langItem.label}
                            </div>
                          );
                        })}
                      {item.id === "line-height" &&
                        lineHeightItems.map((lineHeightItem) => {
                          const active = lineHeightItem.key === getCurrentLineHeight();
                          return (
                            <div
                              key={lineHeightItem.key}
                              className={`ant-dropdown-menu-item ${active ? "ant-dropdown-menu-item-selected" : ""}`}
                              onClick={() => {
                                dropdownHandlers["line-height"]?.(lineHeightItem.key);
                                setOpenDropdown(null);
                              }}
                            >
                              <span className="menu-check-mark">{active ? "✓ " : ""}</span>
                              {lineHeightItem.label}
                            </div>
                          );
                        })}
                    </div>
                  )
                }
              />
            ) : item.type === "color-picker" ? (() => {
              const isBgColor = item.id === "bg-color";
              const currentColor = isBgColor ? selectedBgColor : selectedColor;
              const handleSelect = isBgColor ? handleBgColorSelect : handleColorSelect;
              return (
                <div className="split-color-button" key={item.id}>
                  <Tooltip title={item.label} trigger="hover" mouseEnterDelay={0.5}>
                    <button
                      type="button"
                      className="toolbar-button color-apply-btn"
                      disabled={!editorReady}
                      aria-label={item.label}
                      onMouseDown={() => {
                        if (tiptap) {
                          savedSelectionRef.current = tiptap.state.selection;
                        }
                      }}
                      onClick={() => {
                        if (!tiptap) return;
                        const { view } = tiptap;
                        const color = currentColor;
                        if (savedSelectionRef.current) {
                          view.dispatch(view.state.tr.setSelection(savedSelectionRef.current));
                        }
                        view.focus();
                        if (isBgColor) {
                          setSelectedBgColor(color);
                          tiptap.chain().toggleHighlight({ color }).run();
                        } else {
                          setSelectedColor(color);
                          tiptap.chain().setColor(color).run();
                        }
                      }}
                    >
                      <span className="color-icon-wrap">
                        {isBgColor ? <BgColorsOutlined /> : <EditOutlined />}
                        <span className="color-icon-indicator" style={{ backgroundColor: currentColor }} />
                      </span>
                    </button>
                  </Tooltip>
                  <Dropdown
                    placement="bottomLeft"
                    align={{ offset: [0, 4] }}
                    classNames={{ root: "toolbar-color-dropdown" }}
                    onOpenChange={(open) => {
                      if (open) {
                        if (tiptap) {
                          savedSelectionRef.current = tiptap.state.selection;
                        }
                      }
                    }}
                    popupRender={() => (
                      <div className="color-picker-dropdown">
                        <div className="color-picker-section">
                          <div className="color-picker-header">
                            <span>默认</span>
                          </div>
                          <div className="color-grid">
                            {solidColors.map((row, rowIndex) => (
                              <div key={rowIndex} className="color-grid-row">
                                {row.map((color) => (
                                  <div
                                    key={color}
                                    className={`color-swatch ${currentColor === color ? "selected" : ""}`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => handleSelect(color)}
                                    title={color}
                                  >
                                    {currentColor === color && (
                                      <span className="color-checkmark">✓</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="color-picker-section">
                          <div className="color-picker-header">
                            <span>渐变色</span>
                          </div>
                          <div className="gradient-grid">
                            {gradientColors.map((gradient) => (
                              <div
                                key={gradient.id}
                                className="gradient-swatch"
                                style={{
                                  background: `linear-gradient(to right, ${gradient.colors[0]}, ${gradient.colors[1]})`,
                                }}
                                onClick={() => handleGradientSelect(gradient.id)}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="color-picker-section">
                          <div className="color-picker-header">
                            <span>最近使用自定义颜色</span>
                          </div>
                          <div className="color-picker-empty">暂无</div>
                        </div>

                        <Divider style={{ margin: "6px 0" }} />

                        <div className="color-picker-section">
                          <div className="color-picker-header-advanced">
                            <div className="color-picker-header">
                              <BgColorsOutlined style={{ fontSize: "12px" }} />
                              <span>更多颜色</span>
                            </div>
                            <div className="color-picker-advanced">
                              <ColorPicker
                                value={currentColor}
                                onChange={(color) => {
                                  const hexColor = color.toHexString();
                                  handleSelect(hexColor);
                                }}
                                showText
                                size="small"
                                getPopupContainer={(triggerNode) => {
                                  const dropdown = triggerNode.closest(
                                    ".ant-dropdown",
                                  ) as HTMLElement;
                                  return dropdown || document.body;
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    trigger={["click"]}
                    disabled={!editorReady}
                  >
                    <button
                      type="button"
                      className="color-dropdown-trigger"
                      disabled={!editorReady}
                      aria-label={`${item.label} - 选择颜色`}
                    >
                      <DownOutlined className="color-dropdown-arrow" />
                    </button>
                  </Dropdown>
                </div>
              );
            })() : item.type === "highlight-block-picker" ? (() => {
              return (
                <div className="split-color-button" key={item.id}>
                  <Tooltip title={item.label} trigger="hover" mouseEnterDelay={0.5}>
                    <button
                      type="button"
                      className="toolbar-button color-apply-btn"
                      disabled={!editorReady}
                      aria-label={item.label}
                      onClick={() => {
                        if (!tiptap) return;
                        tiptap.chain().focus().insertHighlightBlock({ backgroundColor: lastHighlightColor }).run();
                      }}
                    >
                      <span className="color-icon-wrap">
                        <HighlightBlockIcon />
                        <span className="color-icon-indicator" style={{ backgroundColor: lastHighlightColor }} />
                      </span>
                    </button>
                  </Tooltip>
                  <Dropdown
                    placement="bottomLeft"
                    align={{ offset: [0, 4] }}
                    classNames={{ root: "toolbar-color-dropdown" }}
                    popupRender={() => (
                      <div className="color-picker-dropdown" style={{ padding: "8px 10px" }}>
                        <div className="color-picker-section">
                          <div className="color-picker-header">选择背景色</div>
                          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                            {highlightBlockColors.map((color) => (
                              <div
                                key={color}
                                className={`color-swatch ${lastHighlightColor === color ? "selected" : ""}`}
                                style={{ backgroundColor: color }}
                                onClick={() => setLastHighlightColor(color)}
                                title={color}
                              >
                                {lastHighlightColor === color && <span className="color-checkmark">✓</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    trigger={["click"]}
                    disabled={!editorReady}
                  >
                    <button
                      type="button"
                      className="color-dropdown-trigger"
                      disabled={!editorReady}
                      aria-label={`${item.label} - 选择颜色`}
                    >
                      <DownOutlined className="color-dropdown-arrow" />
                    </button>
                  </Dropdown>
                </div>
              );
            })() : item.type === "indent-picker" ? (() => {
              return (
                <div className="split-color-button" key={item.id}>
                  <Tooltip title={item.label} trigger="hover" mouseEnterDelay={0.5}>
                    <button
                      type="button"
                      className="toolbar-button color-apply-btn"
                      disabled={!editorReady}
                      aria-label={item.label}
                      onClick={() => {
                        if (!tiptap) return;
                        if (lastIndentAction === "indent") {
                          tiptap.chain().focus().indent().run();
                        } else {
                          tiptap.chain().focus().outdent().run();
                        }
                      }}
                    >
                      {lastIndentAction === "indent" ? <IndentIcon /> : <OutdentIcon />}
                    </button>
                  </Tooltip>
                  <Dropdown
                    placement="bottomLeft"
                    align={{ offset: [0, 4] }}
                    classNames={{ root: "toolbar-color-dropdown" }}
                    popupRender={() => (
                      <div className="ant-dropdown-menu" style={{ borderRadius: "4px", border: "1px solid var(--app-border)", boxShadow: "none" }}>
                        <div
                          className={`ant-dropdown-menu-item ${lastIndentAction === "indent" ? "ant-dropdown-menu-item-selected" : ""}`}
                          onClick={() => {
                            setLastIndentAction("indent");
                            if (tiptap) tiptap.chain().focus().indent().run();
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <IndentIcon /> 增加缩进
                          </span>
                        </div>
                        <div
                          className={`ant-dropdown-menu-item ${lastIndentAction === "outdent" ? "ant-dropdown-menu-item-selected" : ""}`}
                          onClick={() => {
                            setLastIndentAction("outdent");
                            if (tiptap) tiptap.chain().focus().outdent().run();
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <OutdentIcon /> 减少缩进
                          </span>
                        </div>
                      </div>
                    )}
                    trigger={["click"]}
                    disabled={!editorReady}
                  >
                    <button
                      type="button"
                      className="color-dropdown-trigger"
                      disabled={!editorReady}
                      aria-label={`${item.label} - 选择操作`}
                    >
                      <DownOutlined className="color-dropdown-arrow" />
                    </button>
                  </Dropdown>
                </div>
              );
            })() : item.type === "link-picker" ? (
              <Tooltip
                key={item.id}
                placement="bottom"
                title={item.label}
                trigger="hover"
                mouseEnterDelay={0.5}
                open={tooltipOpen[item.id] && !linkPopupOpen}
                onOpenChange={(open) => {
                  setTooltipOpen((prev) => ({ ...prev, [item.id]: open }));
                }}
              >
                <button
                  type="button"
                  className={`toolbar-button ${isActive(item.id) ? "active" : ""}`}
                  disabled={!editorReady}
                  aria-label={item.label}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (tiptap) {
                      savedSelectionRef.current = tiptap.state.selection;
                    }
                  }}
                  onClick={() => {
                    setTooltipOpen((prev) => ({ ...prev, [item.id]: false }));
                    openLinkPopup();
                  }}
                >
                  <span className="toolbar-content">{item.content}</span>
                </button>
              </Tooltip>
            ) : item.type === "format-painter" ? (
              <Dropdown
                key={item.id}
                menu={{
                  items: [
                    {
                      key: "copy",
                      label: "加样式",
                      icon: <PlusOutlined />,
                    },
                    {
                      key: "clear",
                      label: "删除样式",
                      icon: <DeleteOutlined />,
                      disabled: copiedMarks.length === 0,
                    },
                    {
                      key: "apply",
                      label: "应用样式",
                      icon: <CheckOutlined />,
                      disabled: copiedMarks.length === 0,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === "copy") handleCopyStyle();
                    else if (key === "clear") handleClearCopiedStyle();
                    else if (key === "apply") handleApplyStyle();
                  },
                }}
                trigger={["click"]}
                disabled={!editorReady}
              >
                <button
                  type="button"
                  className={`toolbar-button ${copiedMarks.length > 0 ? "active" : ""}`}
                  disabled={!editorReady}
                  aria-label={item.label}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <Tooltip placement="bottom" title={item.label}>
                    <span className="toolbar-content">{item.content}</span>
                  </Tooltip>
                </button>
              </Dropdown>
            ) : (
              <button
                key={item.id}
                type="button"
                className={`toolbar-button ${isActive(item.id) ? "active" : ""}`}
                disabled={!editorReady}
                aria-label={item.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleClick(item.id)}
              >
                <Tooltip placement="bottom" title={item.label}>
                  <span className="toolbar-content">{item.content}</span>
                </Tooltip>
              </button>
            ),
          )}
        </div>
      ))}

      {/* 链接弹出框 - 自定义定位 */}
      {linkPopupOpen && (
        <div
          className="link-picker-popup-overlay"
          style={{
            position: "fixed",
            left: linkPopupPos.x,
            top: linkPopupPos.y,
            zIndex: 1000,
          }}
        >
          <LinkPickerPopup
            textValue={linkTextValue}
            linkValue={linkUrlValue}
            onTextChange={setLinkTextValue}
            onLinkChange={setLinkUrlValue}
            onConfirm={applyLinkFromPopup}
            onClose={() => setLinkPopupOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
