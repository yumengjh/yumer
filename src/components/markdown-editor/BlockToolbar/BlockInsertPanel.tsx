import { useMemo, useState } from "react";
import {
  CheckSquareOutlined,
  CodeOutlined,
  PictureOutlined,
  LinkOutlined,
  OrderedListOutlined,
  TableOutlined,
  UnorderedListOutlined,
  FolderOpenOutlined,
  TagOutlined,
  RightOutlined,
} from "@ant-design/icons";
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

const COMMON_SYNTAX_ITEMS: PanelItem[] = [
  { id: "paragraph", label: "文本", icon: <span className="block-insert-panel__symbol" style={{ fontFamily: 'serif', fontSize: 16 }}>T</span> },
  { id: "heading1", label: "H1", icon: <span className="block-insert-panel__symbol">H1</span> },
  { id: "heading2", label: "H2", icon: <span className="block-insert-panel__symbol">H2</span> },
  { id: "heading3", label: "H3", icon: <span className="block-insert-panel__symbol">H3</span> },
  { id: "heading4", label: "H4", icon: <span className="block-insert-panel__symbol">H4</span> },
  { id: "heading5", label: "H5", icon: <span className="block-insert-panel__symbol">H5</span> },
  { id: "heading6", label: "H6", icon: <span className="block-insert-panel__symbol">H6</span> },
  { id: "bulletList", label: "无序列表", icon: <UnorderedListOutlined /> },
  { id: "orderedList", label: "有序列表", icon: <OrderedListOutlined /> },
  { id: "taskList", label: "代办列表", icon: <CheckSquareOutlined /> },
  { id: "link", label: "链接", icon: <LinkOutlined /> },
  { id: "codeBlock", label: "代码块", icon: <CodeOutlined /> },
];

const QUICK_CARD_ITEMS: PanelItem[] = [
  { id: "image", label: "图片", icon: <PictureOutlined /> },
  { id: "table", label: "表格", icon: <TableOutlined /> },
  { id: "attachment", label: "附件", icon: <FolderOpenOutlined /> },
  { id: "status", label: "状态", icon: <TagOutlined /> },
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
                className="block-insert-panel__recent-chip"
                onClick={() => handleInsert(item.id)}
              >
                <span>{item.label}</span>
              </button>
            ))
          ) : (
            <div className="block-insert-panel__empty">暂无最近使用</div>
          )}
        </div>
      </section>

      <section className="block-insert-panel__section block-insert-panel__section--compact">
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
              <span className="block-insert-panel__card-arrow"><RightOutlined /></span>
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
