import { useMemo, useState } from "react";
import YuqueIcon from "../Toolbar/icons/YuqueIcon";
import { message } from "antd";
import TablePicker from "../Toolbar/TablePicker";
import type { BlockInsertType } from "./blockInsertMenuItems";
import {
  loadRecentBlockInsertItems,
  pushRecentBlockInsertItem,
  removeRecentBlockInsertItem,
  type BlockInsertRecentItemId,
} from "./blockInsertRecent";

interface BlockInsertPanelProps {
  onInsertBlock: (type: BlockInsertType) => void;
  onInsertTable: (rows: number, cols: number) => void;
  onInsertImage: () => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  style?: React.CSSProperties;
}

type PanelItem = {
  id: BlockInsertRecentItemId;
  label: string;
  icon: React.ReactNode;
};

// 图标使用语雀原版：常用语法为工具栏线性图标，基础卡片为语雀插入菜单的彩色卡片图标
const COMMON_SYNTAX_ITEMS: PanelItem[] = [
  { id: "paragraph", label: "正文", icon: <YuqueIcon name="EditorParagraph" /> },
  { id: "heading1", label: "标题 1", icon: <YuqueIcon name="EditorH1" /> },
  { id: "heading2", label: "标题 2", icon: <YuqueIcon name="EditorH2" /> },
  { id: "heading3", label: "标题 3", icon: <YuqueIcon name="EditorH3" /> },
  { id: "heading4", label: "标题 4", icon: <YuqueIcon name="EditorH4" /> },
  { id: "heading5", label: "标题 5", icon: <YuqueIcon name="EditorH5" /> },
  { id: "heading6", label: "标题 6", icon: <YuqueIcon name="EditorH6" /> },
  { id: "bulletList", label: "无序列表", icon: <YuqueIcon name="EditorUnorderedList" /> },
  { id: "orderedList", label: "有序列表", icon: <YuqueIcon name="EditorOrderedList" /> },
  { id: "taskList", label: "任务列表", icon: <YuqueIcon name="EditorTaskList" /> },
  { id: "link", label: "链接", icon: <YuqueIcon name="EditorLink" /> },
  { id: "codeBlock", label: "代码块", icon: <YuqueIcon name="EditorCodeblock" /> },
];

const QUICK_CARD_ITEMS: PanelItem[] = [
  { id: "image", label: "图片", icon: <YuqueIcon name="EditorMainImage" /> },
  { id: "table", label: "表格", icon: <YuqueIcon name="EditorMainTable" /> },
  { id: "attachment", label: "附件", icon: <YuqueIcon name="EditorMainLocalFile" /> },
  { id: "status", label: "状态", icon: <YuqueIcon name="EditorMainStatus" /> },
];

const RECENT_ITEM_META = new Map<BlockInsertRecentItemId, PanelItem>(
  [...COMMON_SYNTAX_ITEMS, ...QUICK_CARD_ITEMS].map((item) => [item.id, item]),
);

export default function BlockInsertPanel({
  onInsertBlock,
  onInsertTable,
  onInsertImage,
  onClose,
  onMouseEnter,
  onMouseLeave,
  style,
}: BlockInsertPanelProps) {
  const [recentItems, setRecentItems] = useState<BlockInsertRecentItemId[]>(() => loadRecentBlockInsertItems());
  const [tablePickerOpen, setTablePickerOpen] = useState(false);

  const visibleRecentItems = useMemo(
    () => recentItems.map((id) => RECENT_ITEM_META.get(id)).filter(Boolean) as PanelItem[],
    [recentItems],
  );

  const markRecent = (id: BlockInsertRecentItemId) => {
    setRecentItems(pushRecentBlockInsertItem(id));
  };

  const handleInsert = (id: BlockInsertRecentItemId) => {
    if (id === "attachment" || id === "status") {
      message.info("暂未实现");
      return;
    }
    if (id === "image") {
      markRecent(id);
      onInsertImage();
      return;
    }
    markRecent(id);
    onInsertBlock(id as BlockInsertType);
    onClose();
  };

  return (
    <div
      className="block-insert-panel"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <section className="block-insert-panel__section block-insert-panel__section--compact">
        <div className="block-insert-panel__section-title">最近使用</div>
        <div className="block-insert-panel__recent">
          {visibleRecentItems.length > 0 ? (
            visibleRecentItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block-insert-panel__syntax-button"
                title={item.label}
                onClick={() => handleInsert(item.id)}
              >
                {item.icon}
              </button>
            ))
          ) : (
            <div className="block-insert-panel__empty">暂无最近使用</div>
          )}
        </div>
      </section>

      <section className="block-insert-panel__section block-insert-panel__section--compact">
        <div className="block-insert-panel__section-title">常用语法</div>
        <div className="block-insert-panel__syntax-grid">
          {COMMON_SYNTAX_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="block-insert-panel__syntax-button"
              onClick={() => handleInsert(item.id)}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </section>

      <section className="block-insert-panel__section block-insert-panel__section--compact">
        <div className="block-insert-panel__section-title">基础</div>
        <div className="block-insert-panel__card-grid">
          <button
            type="button"
            className="block-insert-panel__card"
            onClick={() => handleInsert("image")}
          >
            <span className="block-insert-panel__card-icon">{QUICK_CARD_ITEMS[0].icon}</span>
            <span className="block-insert-panel__card-label">图片</span>
          </button>

          <div
            className="block-insert-panel__card-wrap"
            onMouseEnter={() => setTablePickerOpen(true)}
            onMouseLeave={() => setTablePickerOpen(false)}
          >
            <button
              type="button"
              className="block-insert-panel__card"
              onClick={() => handleInsert("table")}
            >
              <span className="block-insert-panel__card-icon">{QUICK_CARD_ITEMS[1].icon}</span>
              <span className="block-insert-panel__card-label">表格</span>
              <span className="block-insert-panel__card-arrow"><YuqueIcon name="ArrowRight" /></span>
            </button>
            {tablePickerOpen && (
              <div className="block-insert-panel__table-picker-popover">
                <TablePicker
                  onSelect={(rows, cols) => {
                    markRecent("table");
                    onInsertTable(rows, cols);
                    onClose();
                  }}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            className="block-insert-panel__card"
            onClick={() => handleInsert("attachment")}
          >
            <span className="block-insert-panel__card-icon">{QUICK_CARD_ITEMS[2].icon}</span>
            <span className="block-insert-panel__card-label">附件</span>
          </button>

          <button
            type="button"
            className="block-insert-panel__card"
            onClick={() => handleInsert("status")}
          >
            <span className="block-insert-panel__card-icon">{QUICK_CARD_ITEMS[3].icon}</span>
            <span className="block-insert-panel__card-label">状态</span>
          </button>
        </div>
      </section>
    </div>
  );
}
