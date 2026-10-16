import { Tooltip } from 'antd';
import YuqueIcon from '../Toolbar/icons/YuqueIcon';
import './style.css';

interface BlockHandleProps {
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  /** 当前块为空段落：显示「+」，点击打开插入面板 */
  isEmptyBlock?: boolean;
  /** 菜单已打开（语雀 ne-ui-brick-toolbar-trigger-focused） */
  active?: boolean;
}

// 语雀块手柄提示：「可拖拽和点击」
const HANDLE_TOOLTIP = (
  <div className="yq-brick-tooltip">
    <span>可</span>
    <span>拖拽</span>
    <span>和</span>
    <span>点击</span>
  </div>
);

/** 语雀块手柄（ne-ui-brick-toolbar-trigger）：24×24、圆角 6、透明度 .88，悬停变灰底 */
export function BlockHandle({ onClick, onMouseDown, isEmptyBlock, active }: BlockHandleProps) {
  const trigger = (
    <div
      role="button"
      tabIndex={-1}
      className={`yq-brick-trigger${active ? ' is-focused' : ''}${isEmptyBlock ? ' is-insert' : ''}`}
      data-testid="block-handle"
      onClick={onClick}
      onMouseDown={onMouseDown}
      aria-label={isEmptyBlock ? '插入' : '块菜单'}
    >
      <YuqueIcon name={isEmptyBlock ? 'Add' : 'Drag'} />
    </div>
  );

  if (active) return trigger;
  return (
    <Tooltip
      title={isEmptyBlock ? '点击插入' : HANDLE_TOOLTIP}
      placement="top"
      arrow={false}
      mouseEnterDelay={0.3}
      classNames={{ root: 'yq-tooltip' }}
    >
      {trigger}
    </Tooltip>
  );
}
