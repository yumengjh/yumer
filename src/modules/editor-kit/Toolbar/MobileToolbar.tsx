import { useRef, useState } from "react";
import { Drawer, Button, Divider } from "antd";
import { EllipsisOutlined, PlusOutlined } from "@ant-design/icons";
import {
  UndoIcon,
  RedoIcon,
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UnorderedListIcon,
  OrderedListIcon,
  CheckListIcon,
  CodeIcon,
  TextColorIcon,
  BgColorIcon,
  TableIcon,
  DividerIcon,
  ClearFormatIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  PictureIcon,
  HighlightBlockIcon,
} from "./icons";
import { useToolbarActions } from "./useToolbarActions";
import { useMarkdownEditorContext } from "../EditorContext";
import {
  titleLevelItems,
  highlightBlockColors,
  defaultHighlightBlockColor,
  codeLanguageItems,
} from "./data";
import "./MobileToolbar.css";

interface MobileToolbarProps {
  enabledItemIds?: ReadonlySet<string>;
  onAiChatToggle?: () => void;
}

const INSERT_ITEM_IDS = [
  "highlight-block",
  "code-block",
  "code-language",
  "table",
  "image",
] as const;

export default function MobileToolbar({ enabledItemIds, onAiChatToggle }: MobileToolbarProps = {}) {
  const actions = useToolbarActions();
  const { uploadImage } = useMarkdownEditorContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [pressedAction, setPressedAction] = useState<string | null>(null);
  const [lastHighlightColor, setLastHighlightColor] = useState(defaultHighlightBlockColor);
  const [activeInsertItem, setActiveInsertItem] = useState<"highlight-block" | "code-block" | "table" | null>(null);
  const pressedTimerRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const orderedListIconProps = { style: { fontSize: 19 } };
  const checkListIconProps = { style: { fontSize: 20 } };
  const bulletListIconProps = { style: { fontSize: 21 }, strokeWidth: 2.7 };
  const codeIconProps = { style: { fontSize: 19 } };
  const pictureIconProps = { style: { fontSize: 19 }, strokeWidth: 3.25 };
  const tableIconProps = { style: { fontSize: 19 } };

  const clearPressedAction = () => {
    if (pressedTimerRef.current) {
      window.clearTimeout(pressedTimerRef.current);
    }
    pressedTimerRef.current = window.setTimeout(() => {
      setPressedAction(null);
      pressedTimerRef.current = null;
    }, 120);
  };

  const quickActions = [
    ...(onAiChatToggle
      ? [{ id: "ai-chat", icon: <span className="mobile-toolbar-ai-mark">AI</span>, label: "AI 助手" }]
      : []),
    { id: "undo", icon: <UndoIcon />, label: "撤销" },
    { id: "redo", icon: <RedoIcon />, label: "重做" },
    { id: "bold", icon: <BoldIcon />, label: "加粗" },
    { id: "italic", icon: <ItalicIcon />, label: "斜体" },
    { id: "strike", icon: <StrikethroughIcon />, label: "删除线" },
    { id: "underline", icon: <UnderlineIcon />, label: "下划线" },
    { id: "bullet-list", icon: <UnorderedListIcon {...bulletListIconProps} />, label: "无序列表" },
    { id: "ordered-list", icon: <OrderedListIcon {...orderedListIconProps} />, label: "有序列表" },
    { id: "check-list", icon: <CheckListIcon {...checkListIconProps} />, label: "待办列表" },
    { id: "divider", icon: <DividerIcon />, label: "分割线" },
    { id: "clearFormat", icon: <ClearFormatIcon />, label: "清除格式" },
  ];

  const visibleQuickActions = enabledItemIds
    ? quickActions.filter((action) => action.id === "ai-chat" || enabledItemIds.has(action.id))
    : quickActions;
  const visibleInsertItems = INSERT_ITEM_IDS.filter((id) => !enabledItemIds || enabledItemIds.has(id));
  const showInsertButton = visibleInsertItems.length > 0;
  const normalizedVisibleInsertItems = visibleInsertItems.filter((id, index) => {
    if (id !== "code-language") return true;
    return !visibleInsertItems.slice(0, index).includes("code-block");
  });
  const showMoreButton =
    !enabledItemIds ||
    ["text-mode", "align-left", "align-center", "align-right", "text-color", "bg-color"].some((id) =>
      enabledItemIds.has(id),
    );

  const handleHeading = (level: string) => {
    actions.setHeading(parseInt(level, 10));
    setMoreOpen(false);
  };

  const handleTable = () => {
    actions.insertTable(3, 3);
    setInsertOpen(false);
    setMoreOpen(false);
  };

  const handleInsertHighlightBlock = () => {
    if (!actions.editor) return;
    const chain = actions.editor.chain().focus();
    if (actions.editor.state.selection.empty) {
      chain.insertHighlightBlock({ backgroundColor: lastHighlightColor }).run();
    } else {
      chain.toggleHighlightBlockFromSelection({ backgroundColor: lastHighlightColor }).run();
    }
    setInsertOpen(false);
  };

  const handleInsertCodeBlock = () => {
    if (!actions.editor) return;
    actions.editor.chain().focus().setCodeBlock({ language: "plaintext" }).run();
    setInsertOpen(false);
  };

  const handleInsertCodeBlockWithLanguage = (language: string) => {
    if (!actions.editor) return;
    actions.editor.chain().focus().setCodeBlock({ language }).run();
    setInsertOpen(false);
  };

  const handleImageFile = async (file: File) => {
    if (!actions.editor) return;
    if (!uploadImage) {
      actions.message.error("未选择工作空间");
      return;
    }
    try {
      const image = await uploadImage(file);
      actions.editor
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
      setInsertOpen(false);
      setMoreOpen(false);
    } catch (error) {
      actions.message.error(error instanceof Error ? error.message : "图片上传失败");
    }
  };

  return (
    <>
      <div className="mobile-toolbar-wrapper">
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
        {showInsertButton && (
          <div className="mobile-toolbar-insert">
            <button
              type="button"
              className={["mobile-toolbar-btn", pressedAction === "insert" ? "is-pressed" : ""].filter(Boolean).join(" ")}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPressedAction("insert");
                setActiveInsertItem(null);
                setInsertOpen(true);
                clearPressedAction();
              }}
              onPointerCancel={clearPressedAction}
              onPointerLeave={clearPressedAction}
              onPointerUp={clearPressedAction}
              aria-label="插入块"
            >
              <PlusOutlined />
            </button>
          </div>
        )}
        <div className="mobile-toolbar-scroll">
          {visibleQuickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={[
                "mobile-toolbar-btn",
                actions.isActive(action.id) ? "is-active" : "",
                pressedAction === action.id ? "is-pressed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPressedAction(action.id);
                if (action.id === "ai-chat") {
                  onAiChatToggle?.();
                } else {
                  actions.handleClick(action.id);
                }
                clearPressedAction();
              }}
              onPointerCancel={clearPressedAction}
              onPointerLeave={clearPressedAction}
              onPointerUp={clearPressedAction}
              title={action.label}
              aria-label={action.label}
              aria-pressed={actions.isActive(action.id)}
            >
              {action.icon}
            </button>
          ))}
        </div>
        {showMoreButton && (
          <div className="mobile-toolbar-more">
            <button
              type="button"
              className={["mobile-toolbar-btn", pressedAction === "more" ? "is-pressed" : ""].filter(Boolean).join(" ")}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPressedAction("more");
                setMoreOpen(true);
                clearPressedAction();
              }}
              onPointerCancel={clearPressedAction}
              onPointerLeave={clearPressedAction}
              onPointerUp={clearPressedAction}
              aria-label="更多工具"
            >
              <EllipsisOutlined />
            </button>
          </div>
        )}
      </div>

      <Drawer
        title="插入块"
        placement="bottom"
        onClose={() => setInsertOpen(false)}
        open={insertOpen}
        height="50vh"
        styles={{ body: { padding: "16px", overflowY: "auto" } }}
        className="mobile-toolbar-drawer"
      >
        <div className="drawer-section">
          <h4>插入</h4>
          <div className="drawer-grid">
            {normalizedVisibleInsertItems.includes("highlight-block") && (
              <Button
                icon={
                  <span className="color-icon-wrap">
                    <HighlightBlockIcon />
                    <span className="color-icon-indicator" style={{ backgroundColor: lastHighlightColor }} />
                  </span>
                }
                onClick={() => setActiveInsertItem(activeInsertItem === "highlight-block" ? null : "highlight-block")}
              >
                高亮块
              </Button>
            )}
            {(normalizedVisibleInsertItems.includes("code-block") || normalizedVisibleInsertItems.includes("code-language")) && (
              <Button
                icon={<CodeIcon {...codeIconProps} />}
                onClick={() => setActiveInsertItem(activeInsertItem === "code-block" ? null : "code-block")}
              >
                代码块
              </Button>
            )}
            {normalizedVisibleInsertItems.includes("table") && (
              <Button
                icon={<TableIcon {...tableIconProps} />}
                onClick={() => setActiveInsertItem(activeInsertItem === "table" ? null : "table")}
              >
                表格
              </Button>
            )}
            {normalizedVisibleInsertItems.includes("image") && (
              <Button icon={<PictureIcon {...pictureIconProps} />} onClick={() => imageInputRef.current?.click()}>
                上传图片
              </Button>
            )}
          </div>
        </div>

        {activeInsertItem === "highlight-block" && normalizedVisibleInsertItems.includes("highlight-block") && (
          <>
            <Divider />
            <div className="drawer-section">
              <h4>高亮块颜色</h4>
              <div className="mobile-highlight-color-grid">
                {highlightBlockColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch ${lastHighlightColor === color ? "selected" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setLastHighlightColor(color)}
                    aria-label={`选择高亮块颜色 ${color}`}
                  >
                    {lastHighlightColor === color && <span className="color-checkmark">✓</span>}
                  </button>
                ))}
              </div>
              <div className="mobile-insert-action-row">
                <Button type="primary" onClick={handleInsertHighlightBlock}>
                  插入高亮块
                </Button>
              </div>
            </div>
          </>
        )}

        {activeInsertItem === "code-block" && (
          <>
            <Divider />
            <div className="drawer-section">
              <h4>代码语言</h4>
              <div className="mobile-insert-option-list">
                <Button onClick={handleInsertCodeBlock}>默认</Button>
                {codeLanguageItems.map((langItem) => (
                  <Button key={langItem.key} onClick={() => handleInsertCodeBlockWithLanguage(langItem.key)}>
                    {langItem.label}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}

        {activeInsertItem === "table" && normalizedVisibleInsertItems.includes("table") && (
          <>
            <Divider />
            <div className="drawer-section">
              <h4>表格尺寸</h4>
              <div className="mobile-insert-option-list mobile-insert-option-list--grid">
                {[
                  { rows: 3, cols: 3 },
                  { rows: 4, cols: 4 },
                  { rows: 5, cols: 3 },
                  { rows: 5, cols: 5 },
                ].map((size) => (
                  <Button
                    key={`${size.rows}x${size.cols}`}
                    onClick={() => {
                      actions.insertTable(size.rows, size.cols);
                      setInsertOpen(false);
                    }}
                  >
                    {size.rows}×{size.cols}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </Drawer>

      <Drawer
        title="更多工具"
        placement="bottom"
        onClose={() => setMoreOpen(false)}
        open={moreOpen}
        height="50vh"
        styles={{ body: { padding: "16px", overflowY: "auto" } }}
        className="mobile-toolbar-drawer"
      >
        <div className="drawer-section">
          <h4>标题</h4>
          <div className="drawer-grid">
            {titleLevelItems.map((item) => (
              <Button
                key={item.key}
                type={actions.getCurrentHeadingKey() === item.key ? "primary" : "default"}
                onClick={() => handleHeading(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        <Divider />

        <div className="drawer-section">
          <h4>排版</h4>
          <div className="drawer-grid">
            <Button
              icon={<AlignLeftIcon />}
              type={actions.isActive("align-left") ? "primary" : "default"}
              onClick={() => {
                actions.handleClick("align-left");
                setMoreOpen(false);
              }}
            >
              左对齐
            </Button>
            <Button
              icon={<AlignCenterIcon />}
              type={actions.isActive("align-center") ? "primary" : "default"}
              onClick={() => {
                actions.handleClick("align-center");
                setMoreOpen(false);
              }}
            >
              居中
            </Button>
            <Button
              icon={<AlignRightIcon />}
              type={actions.isActive("align-right") ? "primary" : "default"}
              onClick={() => {
                actions.handleClick("align-right");
                setMoreOpen(false);
              }}
            >
              右对齐
            </Button>
          </div>
        </div>

        <Divider />

        <div className="drawer-section">
          <h4>颜色</h4>
          <div className="drawer-grid">
            <Button
              icon={<TextColorIcon />}
              onClick={() => {
                actions.setTextColor("#1677ff");
                setMoreOpen(false);
              }}
            >
              蓝色文字
            </Button>
            <Button
              icon={<BgColorIcon />}
              onClick={() => {
                actions.setBgColor("#FFF2CC");
                setMoreOpen(false);
              }}
            >
              高亮背景
            </Button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
