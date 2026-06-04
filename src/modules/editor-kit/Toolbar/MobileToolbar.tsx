import { useRef, useState } from "react";
import { Drawer, Button, Divider } from "antd";
import { EllipsisOutlined, HighlightOutlined } from "@ant-design/icons";
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
  BgColorIcon,
  TableIcon,
  DividerIcon,
  ClearFormatIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  PictureIcon,
} from "./icons";
import { useToolbarActions } from "./useToolbarActions";
import { useMarkdownEditorContext } from "../EditorContext";
import { titleLevelItems } from "./data";
import "./MobileToolbar.css";

export default function MobileToolbar() {
  const actions = useToolbarActions();
  const { uploadImage } = useMarkdownEditorContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pressedAction, setPressedAction] = useState<string | null>(null);
  const pressedTimerRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const clearPressedAction = () => {
    if (pressedTimerRef.current) {
      window.clearTimeout(pressedTimerRef.current);
    }
    pressedTimerRef.current = window.setTimeout(() => {
      setPressedAction(null);
      pressedTimerRef.current = null;
    }, 120);
  };

  // 高频操作列表（外层横向滑动区）
  const quickActions = [
    { id: "undo",         icon: <UndoIcon />,           label: "撤销" },
    { id: "redo",         icon: <RedoIcon />,           label: "重做" },
    { id: "bold",         icon: <BoldIcon />,           label: "加粗" },
    { id: "italic",       icon: <ItalicIcon />,         label: "斜体" },
    { id: "strike",       icon: <StrikethroughIcon />,  label: "删除线" },
    { id: "underline",    icon: <UnderlineIcon />,      label: "下划线" },
    { id: "bullet-list",  icon: <UnorderedListIcon />,  label: "无序列表" },
    { id: "ordered-list", icon: <OrderedListIcon />,    label: "有序列表" },
    { id: "check-list",   icon: <CheckListIcon />,      label: "任务列表" },
    { id: "code-block",   icon: <CodeIcon />,           label: "代码块" },
    { id: "divider",      icon: <DividerIcon />,        label: "分割线" },
    { id: "clearFormat",  icon: <ClearFormatIcon />,    label: "清除格式" },
  ];

  const handleHeading = (level: string) => {
    actions.setHeading(parseInt(level, 10));
    setMoreOpen(false);
  };

  const handleTable = () => {
    actions.insertTable(3, 3);
    setMoreOpen(false);
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
      setMoreOpen(false);
    } catch (error) {
      actions.message.error(error instanceof Error ? error.message : "图片上传失败");
    }
  };

  return (
    <>
      {/* 工具栏：sticky 吸附在顶部导航栏正下方 */}
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
        <div className="mobile-toolbar-scroll">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={[
                "mobile-toolbar-btn",
                actions.isActive(action.id) ? "is-active" : "",
                pressedAction === action.id ? "is-pressed" : "",
              ].filter(Boolean).join(" ")}
              onPointerDown={(e) => {
                // Use pointerdown instead of click to keep the editor selection stable.
                e.preventDefault();
                e.stopPropagation();
                setPressedAction(action.id);
                actions.handleClick(action.id);
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
        {/* 更多按钮：分隔线 + 图标 */}
        <div className="mobile-toolbar-more">
          <button
            type="button"
            className={[
              "mobile-toolbar-btn",
              pressedAction === "more" ? "is-pressed" : "",
            ].filter(Boolean).join(" ")}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPressedAction("more");
              setMoreOpen(true);
              clearPressedAction();
            }}
            onPointerCancel={clearPressedAction}
            onPointerLeave={clearPressedAction}
            onPointerUp={clearPressedAction}
            aria-label="More"
          >
            <EllipsisOutlined />
          </button>
        </div>
      </div>

      {/* 底部抽屉：低频操作 */}
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
            <Button icon={<AlignLeftIcon />}   type={actions.isActive("align-left")   ? "primary" : "default"} onClick={() => { actions.handleClick("align-left");   setMoreOpen(false); }}>左对齐</Button>
            <Button icon={<AlignCenterIcon />} type={actions.isActive("align-center") ? "primary" : "default"} onClick={() => { actions.handleClick("align-center"); setMoreOpen(false); }}>居中</Button>
            <Button icon={<AlignRightIcon />}  type={actions.isActive("align-right")  ? "primary" : "default"} onClick={() => { actions.handleClick("align-right");  setMoreOpen(false); }}>右对齐</Button>
          </div>
        </div>

        <Divider />

        <div className="drawer-section">
          <h4>颜色与插入</h4>
          <div className="drawer-grid">
            <Button icon={<HighlightOutlined />} onClick={() => { actions.setTextColor("#1677ff"); setMoreOpen(false); }}>蓝色文字</Button>
            <Button icon={<BgColorIcon />}  onClick={() => { actions.setBgColor("#FFF2CC");  setMoreOpen(false); }}>高亮背景</Button>
            <Button icon={<TableIcon />}     onClick={handleTable}>插入 3×3 表格</Button>
            <Button icon={<PictureIcon />}   onClick={() => imageInputRef.current?.click()}>上传图片</Button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
