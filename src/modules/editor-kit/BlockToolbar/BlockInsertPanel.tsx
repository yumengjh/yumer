import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import YuqueIcon, { type YuqueIconName } from "../Toolbar/icons/YuqueIcon";

/**
 * 语雀「插入」面板（工具栏最左侧「+」、块菜单「在下方添加」共用，后续斜线命令也复用）。
 * 结构与样式对齐语雀 ne-ui-search-card-menu：搜索框 + 分组（基础两列卡片 / 普通列表）。
 */
export type InsertCardId = "image" | "table" | "codeBlock" | "highlightBlock" | "blockquote" | "divider";

export interface InsertCardItem {
  id: InsertCardId;
  title: string;
  /** 语雀快捷输入（拼音首字母），用于搜索与右侧提示 */
  shortcut: string;
  describe?: string;
  icon: YuqueIconName;
}

interface InsertCardGroup {
  title: string;
  layout: "two-column" | "normal";
  items: InsertCardItem[];
}

export const INSERT_CARD_GROUPS: InsertCardGroup[] = [
  {
    title: "基础",
    layout: "two-column",
    items: [
      { id: "image", title: "图片", shortcut: "tp", icon: "EditorMainImage" },
      { id: "table", title: "表格", shortcut: "bg", icon: "EditorMainTable" },
    ],
  },
  {
    title: "程序员专区",
    layout: "normal",
    items: [
      { id: "codeBlock", title: "代码块", shortcut: "dmk", describe: "支持多种语言和主题切换", icon: "EditorMainCodeBlock" },
    ],
  },
  {
    title: "布局和样式",
    layout: "normal",
    items: [
      { id: "highlightBlock", title: "高亮块", shortcut: "glk", describe: "用彩色背景来高亮提示", icon: "EditorMainHighlightBlock" },
      { id: "blockquote", title: "引用", shortcut: "yy", describe: "插入引用格式", icon: "EditorMainReference" },
      { id: "divider", title: "插入分割线", shortcut: "fgx", describe: "分割线", icon: "EditorMainSplitLine" },
    ],
  },
];

const ALL_ITEMS = INSERT_CARD_GROUPS.flatMap((group) => group.items);

export function searchInsertCards(query: string): InsertCardItem[] {
  const keyword = query.trim().toLowerCase().replace(/^\//, "");
  if (!keyword) return ALL_ITEMS;
  return ALL_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(keyword) || item.shortcut.includes(keyword),
  );
}

export interface InsertCardOptions {
  rows?: number;
  cols?: number;
}

interface BlockInsertPanelProps {
  onSelect: (id: InsertCardId, options?: InsertCardOptions) => void;
  /** 工具栏「+」显示搜索框；块菜单「在下方添加」不显示 */
  searchable?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const TABLE_MIN = 4;
const TABLE_MAX = 10;

/** 语雀表格尺寸选择器：随悬停向外扩展一行一列 */
function TableSizeSelector({ onSelect }: { onSelect: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  const rowCount = Math.min(TABLE_MAX, Math.max(TABLE_MIN, hover.rows + 1));
  const colCount = Math.min(TABLE_MAX, Math.max(TABLE_MIN, hover.cols + 1));
  return (
    <div className="yq-table-selector" onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
      <div className="yq-table-selector__title">表格</div>
      {Array.from({ length: rowCount }, (_, row) => (
        <div key={row} className="yq-table-selector__row">
          {Array.from({ length: colCount }, (_, col) => (
            <div
              key={col}
              className={`yq-table-selector__cell${row < hover.rows && col < hover.cols ? " is-selected" : ""}`}
              onMouseEnter={() => setHover({ rows: row + 1, cols: col + 1 })}
              onMouseDown={(event) => {
                // 浮层挂在 body 上，用 mousedown 触发，避免外层下拉先把面板关掉
                event.preventDefault();
                onSelect(row + 1, col + 1);
              }}
            />
          ))}
        </div>
      ))}
      <div className="yq-table-selector__counter">
        {hover.rows} x {hover.cols}
      </div>
    </div>
  );
}

function MenuItem({
  item,
  layout,
  selected,
  onSelect,
  onHover,
}: {
  item: InsertCardItem;
  layout: "two-column" | "normal";
  selected?: boolean;
  onSelect: (id: InsertCardId, options?: InsertCardOptions) => void;
  onHover?: () => void;
}) {
  const [tableAnchor, setTableAnchor] = useState<DOMRect | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const isTable = item.id === "table";
  const showTable = (element: HTMLElement) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setTableAnchor(element.getBoundingClientRect());
  };
  const hideTable = () => {
    hideTimerRef.current = window.setTimeout(() => setTableAnchor(null), 120);
  };
  return (
    <div
      className={`yq-insert-item${selected ? " is-selected" : ""}`}
      data-testid={`card-menu-item-${item.id}`}
      onMouseEnter={(event) => {
        onHover?.();
        if (isTable && layout === "two-column") showTable(event.currentTarget);
      }}
      onMouseLeave={() => isTable && hideTable()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(item.id, isTable ? { rows: 3, cols: 3 } : undefined)}
    >
      <div className="yq-insert-item__icon">
        <YuqueIcon name={item.icon} />
      </div>
      <div className="yq-insert-item__content">
        <div className="yq-insert-item__title">
          {isTable && layout === "two-column" && (
            <span className="yq-insert-item__right">
              <YuqueIcon name="menu-card-right-arrow" />
            </span>
          )}
          {layout === "normal" && <span className="yq-insert-item__key">/{item.shortcut}</span>}
          {item.title}
        </div>
        {layout === "normal" && item.describe && <div className="yq-insert-item__describe">{item.describe}</div>}
      </div>
      {isTable &&
        tableAnchor &&
        createPortal(
          <div
            className="yq-insert-item__popover block-menu-popover yq-overlay"
            style={{ left: tableAnchor.right - 2, top: tableAnchor.top }}
            onMouseEnter={() => hideTimerRef.current && window.clearTimeout(hideTimerRef.current)}
            onMouseLeave={hideTable}
            // React 事件会穿过 portal 冒泡到菜单项，避免再触发一次默认 3×3 插入
            onClick={(event) => event.stopPropagation()}
          >
            <TableSizeSelector onSelect={(rows, cols) => onSelect("table", { rows, cols })} />
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function BlockInsertPanel({
  onSelect,
  searchable = false,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
}: BlockInsertPanelProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (query.trim() ? searchInsertCards(query) : null), [query]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[selectedIndex];
      if (item) onSelect(item.id, item.id === "table" ? { rows: 3, cols: 3 } : undefined);
    }
  };

  return (
    <div
      className={["yq-insert-panel", results ? "show-selected" : "show-hover", className].filter(Boolean).join(" ")}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {searchable && (
        <div className="yq-insert-panel__search">
          <span className="yq-insert-panel__search-box" onMouseDown={() => inputRef.current?.focus()}>
            <YuqueIcon name="menu-card-search" className="yq-insert-panel__search-icon" />
            <input
              ref={inputRef}
              placeholder="请输入要搜索的功能名称"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </span>
        </div>
      )}
      {results && results.length === 0 ? (
        <div className="yq-insert-panel__empty">暂无匹配的搜索结果</div>
      ) : (
        <div className="yq-insert-panel__content">
          {results ? (
            <div className="yq-insert-group normal">
              <div className="yq-insert-group__title">搜索结果</div>
              {results.map((item, index) => (
                <MenuItem
                  key={item.id}
                  item={item}
                  layout="normal"
                  selected={index === selectedIndex}
                  onHover={() => setSelectedIndex(index)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ) : (
            INSERT_CARD_GROUPS.map((group) => (
              <div key={group.title} className={`yq-insert-group ${group.layout}`}>
                <div className="yq-insert-group__title">{group.title}</div>
                <div className="yq-insert-group__content">
                  {group.items.map((item) => (
                    <MenuItem key={item.id} item={item} layout={group.layout} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
