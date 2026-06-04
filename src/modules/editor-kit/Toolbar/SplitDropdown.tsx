import { Dropdown, Tooltip } from "antd";
import type { ReactNode } from "react";
import { ChevronIcon } from "./icons";
import "./style.css";

interface SplitDropdownProps {
  /** 左侧按钮内容 */
  content: ReactNode;
  /** tooltip 提示 */
  label: string;
  /** 下拉菜单内容 */
  dropdownContent: ReactNode;
  /** 左侧按钮点击事件 */
  onApply: () => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 左侧按钮是否高亮 */
  active?: boolean;
  /** 自定义下拉菜单类名 */
  overlayClassName?: string;
  /** 下拉菜单打开状态控制 */
  open?: boolean;
  /** 下拉菜单打开状态变化回调 */
  onOpenChange?: (open: boolean) => void;
}

export default function SplitDropdown({
  content,
  label,
  dropdownContent,
  onApply,
  disabled = false,
  active = false,
  overlayClassName,
  open,
  onOpenChange,
}: SplitDropdownProps) {
  return (
    <div className={`split-dropdown ${active ? "is-active" : ""} ${open ? "is-open" : ""}`}>
      <Tooltip placement="bottom" title={label} trigger="hover" mouseEnterDelay={0.5}>
        <button
          type="button"
          className={`split-dropdown-main ${active ? "active" : ""}`}
          disabled={disabled}
          aria-label={label}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onApply();
          }}
        >
          <span className="split-dropdown-content">{content}</span>
        </button>
      </Tooltip>
      <Dropdown
        classNames={{ root: overlayClassName }}
        trigger={["click"]}
        disabled={disabled}
        open={open}
        onOpenChange={onOpenChange}
        popupRender={() => dropdownContent}
      >
        <button
          type="button"
          className="split-dropdown-trigger"
          disabled={disabled}
          aria-label={`${label} - 选择`}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <ChevronIcon className="split-dropdown-arrow" />
        </button>
      </Dropdown>
    </div>
  );
}
