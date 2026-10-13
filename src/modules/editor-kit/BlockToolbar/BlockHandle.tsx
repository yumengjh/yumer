import './style.css';

function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="4" cy="2" r="1.2" />
      <circle cx="10" cy="2" r="1.2" />
      <circle cx="4" cy="7" r="1.2" />
      <circle cx="10" cy="7" r="1.2" />
      <circle cx="4" cy="12" r="1.2" />
      <circle cx="10" cy="12" r="1.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6 1.5v9M1.5 6h9" />
    </svg>
  );
}

interface BlockHandleProps {
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  /** 点击「+」：在当前块下方插入 */
  onInsertClick?: () => void;
  active?: boolean;
}

export function BlockHandle({ onClick, onMouseDown, onInsertClick, active }: BlockHandleProps) {
  return (
    <div className="block-handle__group">
      {onInsertClick && (
        <button
          type="button"
          className="block-handle__insert"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertClick}
          title="在下方插入"
          aria-label="在下方插入"
        >
          <PlusIcon />
        </button>
      )}
      <button
        type="button"
        className={`block-handle__btn${active ? ' is-active' : ''}`}
        onClick={onClick}
        onMouseDown={onMouseDown}
        title="点击打开菜单 / 拖拽移动块"
        aria-label="块菜单"
      >
        <DragHandleIcon />
      </button>
    </div>
  );
}
