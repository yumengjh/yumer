import { useRef, useState } from "react";
import { Drawer, Button, Divider } from "antd";
import {
  UndoOutlined,
  RedoOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  BgColorsOutlined,
  TableOutlined,
  MinusOutlined,
  EllipsisOutlined,
  ClearOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  HighlightOutlined,
} from "@ant-design/icons";
import { useToolbarActions } from "./useToolbarActions";
import { titleLevelItems } from "./data";
import "./MobileToolbar.css";

export default function MobileToolbar() {
  const actions = useToolbarActions();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pressedAction, setPressedAction] = useState<string | null>(null);
  const pressedTimerRef = useRef<number | null>(null);

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
    { id: "undo",         icon: <UndoOutlined />,           label: "撤销" },
    { id: "redo",         icon: <RedoOutlined />,           label: "重做" },
    { id: "bold",         icon: <BoldOutlined />,           label: "加粗" },
    { id: "italic",       icon: <ItalicOutlined />,         label: "斜体" },
    { id: "strike",       icon: <StrikethroughOutlined />,  label: "删除线" },
    { id: "underline",    icon: <UnderlineOutlined />,      label: "下划线" },
    { id: "bullet-list",  icon: <UnorderedListOutlined />,  label: "无序列表" },
    { id: "ordered-list", icon: <OrderedListOutlined />,    label: "有序列表" },
    { id: "check-list",   icon: <CheckSquareOutlined />,    label: "任务列表" },
    { id: "code-block",   icon: <CodeOutlined />,           label: "代码块" },
    { id: "divider",      icon: <MinusOutlined />,          label: "分割线" },
    { id: "clearFormat",  icon: <ClearOutlined />,          label: "清除格式" },
  ];

  const handleHeading = (level: string) => {
    actions.setHeading(parseInt(level, 10));
    setMoreOpen(false);
  };

  const handleTable = () => {
    actions.insertTable(3, 3);
    setMoreOpen(false);
  };

  return (
    <>
      {/* 工具栏：sticky 吸附在顶部导航栏正下方 */}
      <div className="mobile-toolbar-wrapper">
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
            <Button icon={<AlignLeftOutlined />}   type={actions.isActive("align-left")   ? "primary" : "default"} onClick={() => { actions.handleClick("align-left");   setMoreOpen(false); }}>左对齐</Button>
            <Button icon={<AlignCenterOutlined />} type={actions.isActive("align-center") ? "primary" : "default"} onClick={() => { actions.handleClick("align-center"); setMoreOpen(false); }}>居中</Button>
            <Button icon={<AlignRightOutlined />}  type={actions.isActive("align-right")  ? "primary" : "default"} onClick={() => { actions.handleClick("align-right");  setMoreOpen(false); }}>右对齐</Button>
          </div>
        </div>

        <Divider />

        <div className="drawer-section">
          <h4>颜色与插入</h4>
          <div className="drawer-grid">
            <Button icon={<HighlightOutlined />} onClick={() => { actions.setTextColor("#1677ff"); setMoreOpen(false); }}>蓝色文字</Button>
            <Button icon={<BgColorsOutlined />}  onClick={() => { actions.setBgColor("#FFF2CC");  setMoreOpen(false); }}>高亮背景</Button>
            <Button icon={<TableOutlined />}     onClick={handleTable}>插入 3×3 表格</Button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
