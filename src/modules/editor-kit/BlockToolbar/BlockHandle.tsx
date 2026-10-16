import { Tooltip } from 'antd';
import YuqueIcon from '../Toolbar/icons/YuqueIcon';
import './style.css';

interface BlockHandleProps {
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  /** 当前块为空段落：与语雀一致显示「+」，点击打开插入面板 */
  isEmptyBlock?: boolean;
  /** 菜单已打开（focused 态） */
  active?: boolean;
}

// 语雀块手柄的提示：「可拖拽和点击」，动词高亮
const HANDLE_TOOLTIP = (
  <div className="block-handle-tooltip">
    <span>可</span>
    <span>拖拽</span>
    <span>和</span>
    <span>点击</span>
  </div>
);

export function BlockHandle({ onClick, onMouseDown, isEmptyBlock, active }: BlockHandleProps) {
  const trigger = (
    <button
      type="button"
      className={`block-handle__btn${active ? ' is-active' : ''}${isEmptyBlock ? ' is-insert' : ''}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
      aria-label={isEmptyBlock ? '插入' : '块菜单'}
    >
      <YuqueIcon name={isEmptyBlock ? 'Add' : 'Drag'} />
    </button>
  );

  if (active) return trigger;
  return (
    <Tooltip
      title={isEmptyBlock ? '点击插入' : HANDLE_TOOLTIP}
      placement="top"
      mouseEnterDelay={0.4}
      classNames={{ root: 'block-handle-tooltip-overlay' }}
    >
      {trigger}
    </Tooltip>
  );
}
