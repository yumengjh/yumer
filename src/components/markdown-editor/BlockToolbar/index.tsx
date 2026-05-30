import { useEffect, useState, useCallback, useRef } from 'react';
import { useMarkdownEditor } from '../EditorContext';
import { BlockHandle } from './BlockHandle';
import { BlockMenu } from './BlockMenu';
import { resolveBlockToolbarTarget, type BlockToolbarTarget } from './blockTarget';
import { planExplicitMoveSortKey, withExplicitMoveSortKeyAttrs } from './sortKeyReorder';
import './style.css';

interface BlockToolbarProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

const DRAG_THRESHOLD = 3;
const AUTO_SCROLL_ZONE = 40;
const AUTO_SCROLL_MAX_SPEED = 12;
const GHOST_OFFSET_X = 12;
const GHOST_OFFSET_Y = 6;

const BLOCK_EXTRA_OFFSET: Record<string, number> = {
  // 列表项：bullet/数字占位，额外退�?
  LI: 28,
  // 引用块：左边�?+ padding
  BLOCKQUOTE: 8,
  // 代码块容器（TipTap 通常渲染�?pre�?
  PRE: 8,
  // 默认：段落、标题等无装饰块
  DEFAULT: 0,
};

// 根据 data-type 属性的额外偏移（TipTap 自定义节点）
const BLOCK_TYPE_EXTRA_OFFSET: Record<string, number> = {
  taskItem: 32,      // 任务列表：checkbox 占位
  callout: 12,      // 高亮/callout 块：有背�?+ padding
  codeBlock: 8,     // 代码�?
  blockquote: 8,
};

// 句柄宽度（block-handle__btn 的宽度）
const HANDLE_WIDTH = 20;
// 句柄与块可视边缘之间的最小间�?
const MIN_GAP = 4;


export default function BlockToolbar({ wrapperRef }: BlockToolbarProps) {
  const editor = useMarkdownEditor();
  const [hoveredBlock, setHoveredBlock] = useState<HTMLElement | null>(null);
  const [hoveredAnchor, setHoveredAnchor] = useState<HTMLElement | null>(null);
  const [hoveredTableCell, setHoveredTableCell] = useState<HTMLTableCellElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [menuState, setMenuState] = useState<'closed' | 'open' | 'closing'>('closed');
  const [ready, setReady] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const prevBlockRef = useRef<HTMLElement | null>(null);
  const prevAnchorRef = useRef<HTMLElement | null>(null);
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const hoveredAnchorRef = useRef<HTMLElement | null>(null);
  const pendingDeleteFallbackRef = useRef<{
    element: HTMLElement | null;
    clientX: number;
    clientY: number;
  } | null>(null);

  // ---- Drag refs ----
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragSourceRef = useRef<HTMLElement | null>(null);
  const ghostElementRef = useRef<HTMLElement | null>(null);
  const dropIndicatorRef = useRef<HTMLElement | null>(null);
  const blockElementsRef = useRef<HTMLElement[]>([]);
  const sourceIndexRef = useRef(-1);
  const animationFrameRef = useRef<number | null>(null);
  const dropTargetIndexRef = useRef(-1);
  const isDraggingActiveRef = useRef(false);
  const justDraggedRef = useRef(false);

  const openMenu = useCallback(() => setMenuState('open'), []);
  const closeMenu = useCallback(() => setMenuState('closing'), []);
  const menuVisible = menuState !== 'closed';

  const getEditorDom = useCallback((): HTMLElement | null => {
    try { return editor?.view.dom ?? null; } catch { return null; }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let retryId: ReturnType<typeof setTimeout> | null = null;
    const tryMount = () => {
      try {
        if (editor.view.dom) { setReady(true); return; }
      } catch {
        // Editor DOM is not mounted yet; retry below.
      }
      retryId = setTimeout(tryMount, 50);
    };
    tryMount();
    return () => { if (retryId) clearTimeout(retryId); };
  }, [editor]);

  // 块切换时：从 null �?block 不动画，block �?block 动画
  useEffect(() => {
    if (hoveredAnchor && prevAnchorRef.current && prevAnchorRef.current !== hoveredAnchor) {
      setShouldAnimate(true);
    } else {
      setShouldAnimate(false);
    }
    prevBlockRef.current = hoveredBlock;
    prevAnchorRef.current = hoveredAnchor;
  }, [hoveredBlock, hoveredAnchor]);

  useEffect(() => {
    hoveredBlockRef.current = hoveredBlock;
    hoveredAnchorRef.current = hoveredAnchor;
  }, [hoveredBlock, hoveredAnchor]);

  const findBlockTarget = useCallback((element: HTMLElement | null, clientY?: number): BlockToolbarTarget | null => {
    if (!element) return null;
    const editorElement = getEditorDom();
    if (!editorElement) return null;
    return resolveBlockToolbarTarget(element, editorElement, clientY);
  }, [getEditorDom]);

const updatePosition = useCallback((block: HTMLElement) => {
  const wrapper = wrapperRef.current;
  if (!wrapper) return;
  const wrapperRect = wrapper.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();

  // 1. 块的可视左边缘（�?border�?
  const blockVisualLeft = blockRect.left;

  // 2. 读取块自身的 paddingLeft（部分块�?padding 来给 bullet/装饰留位�?
  const computed = window.getComputedStyle(block);

  // 3. 从误差表查额外偏�?
  const tagExtra = BLOCK_EXTRA_OFFSET[block.tagName] ?? BLOCK_EXTRA_OFFSET.DEFAULT;
  const typeExtra = block.dataset.type
    ? (BLOCK_TYPE_EXTRA_OFFSET[block.dataset.type] ?? 0)
    : 0;
  const taskItemExtra = block.classList.contains('task-list-item')
    ? BLOCK_TYPE_EXTRA_OFFSET.taskItem
    : 0;
  const extra = Math.max(tagExtra, typeExtra, taskItemExtra);

  // 4. 工具�?left = 块可视左边缘 - 句柄宽度 - 最小间�?- 额外偏移
  //    转换为相对于 wrapper 的坐�?
  const left = Math.max(
    0,
    blockVisualLeft - wrapperRect.left + wrapper.scrollLeft
      - HANDLE_WIDTH - MIN_GAP - extra
  );

  // 5. top 对齐块的顶部（考虑 paddingTop 让句柄视觉上居中于首行）
  const computedPaddingTop = parseFloat(computed.paddingTop) || 0;
  const top =
    blockRect.top - wrapperRect.top + wrapper.scrollTop + computedPaddingTop;

  setPosition({ top, left });
}, [wrapperRef]);

  useEffect(() => {
    if (!ready) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

  const handleWrapperMouseMove = (e: MouseEvent) => {
      if (isDraggingActiveRef.current) return;
      if (menuVisible) return;
      const eventTarget = e.target as HTMLElement;
      if (eventTarget.closest('.block-handle-wrapper') || eventTarget.closest('.block-menu-popover')) return;
      const currentAnchor = hoveredAnchorRef.current;
      if (currentAnchor) {
        const anchorRect = currentAnchor.getBoundingClientRect();
        const isMovingTowardCurrentHandle =
          e.clientX < anchorRect.left &&
          e.clientX >= position.left - 8 &&
          e.clientY >= anchorRect.top - 6 &&
          e.clientY <= anchorRect.bottom + 6;
        if (isMovingTowardCurrentHandle) return;
      }
      const target = findBlockTarget(eventTarget, e.clientY);
      const block = target?.element ?? null;
      const anchor = target?.anchorElement ?? block;
      const tableCell = target?.tableCellElement ?? null;
      if (block && anchor && (block !== hoveredBlock || anchor !== hoveredAnchor || tableCell !== hoveredTableCell)) {
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
          hideTimeoutRef.current = null;
        }
        setHoveredBlock(block);
        setHoveredAnchor(anchor);
        setHoveredTableCell(tableCell);
        updatePosition(anchor);
      }
    };

    const handleWrapperMouseLeave = (e: MouseEvent) => {
      if (isDraggingActiveRef.current) return;
      if (menuVisible) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || !wrapper.contains(related)) {
        hideTimeoutRef.current = setTimeout(() => {
          setHoveredBlock(null);
          setHoveredAnchor(null);
          setHoveredTableCell(null);
        }, 200);
      }
    };

    wrapper.addEventListener('mousemove', handleWrapperMouseMove);
    wrapper.addEventListener('mouseleave', handleWrapperMouseLeave);

    return () => {
      wrapper.removeEventListener('mousemove', handleWrapperMouseMove);
      wrapper.removeEventListener('mouseleave', handleWrapperMouseLeave);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [ready, getEditorDom, findBlockTarget, updatePosition, hoveredBlock, hoveredAnchor, hoveredTableCell, wrapperRef, menuVisible, position.left]);

  const handleKeepVisible = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // 编辑器内容变化时重新计算位置（块位置可能已改变）
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const editorDom = editor.view.dom;
      const currentBlock = hoveredBlockRef.current;
      const currentAnchor = hoveredAnchorRef.current;

      if (
        (currentBlock && !editorDom.contains(currentBlock)) ||
        (currentAnchor && !editorDom.contains(currentAnchor))
      ) {
        const fallback = pendingDeleteFallbackRef.current;
        pendingDeleteFallbackRef.current = null;

        const fallbackElement = fallback?.element && editorDom.contains(fallback.element)
          ? fallback.element
          : fallback
            ? document.elementFromPoint(fallback.clientX, fallback.clientY)
            : null;

        const nextTarget = resolveBlockToolbarTarget(fallbackElement, editorDom, fallback?.clientY);
        if (nextTarget) {
          setHoveredBlock(nextTarget.element);
          setHoveredAnchor(nextTarget.anchorElement);
          setHoveredTableCell(nextTarget.tableCellElement ?? null);
          updatePosition(nextTarget.anchorElement);
          setUpdateCount(c => c + 1);
          return;
        }

        setHoveredBlock(null);
        setHoveredAnchor(null);
        setHoveredTableCell(null);
        setMenuState('closed');
        return;
      }

      setUpdateCount(c => c + 1);
    };
    editor.on('transaction', onUpdate);
    return () => { editor.off('transaction', onUpdate); };
  }, [editor, updatePosition]);

  const handleWillDeleteBlock = useCallback((fallbackBlock: HTMLElement | null) => {
    if (!fallbackBlock) {
      pendingDeleteFallbackRef.current = null;
      return;
    }

    const rect = fallbackBlock.getBoundingClientRect();
    pendingDeleteFallbackRef.current = {
      element: fallbackBlock,
      clientX: rect.left + Math.min(rect.width / 2, 24),
      clientY: rect.top + rect.height / 2,
    };
  }, []);

  // hoveredBlock 变化或编辑器更新时刷新位�?
  useEffect(() => {
    if (!hoveredAnchor) return;
    updatePosition(hoveredAnchor);
    const onResize = () => updatePosition(hoveredAnchor);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hoveredAnchor, updateCount, updatePosition]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuVisible) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.block-menu-popover') && !target.closest('.block-handle__btn')) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuVisible, closeMenu]);

  // ---- Drag: move block via ProseMirror delete + insert ----
  const moveBlock = useCallback((targetGapIndex: number) => {
    if (!editor) return;
    try {
      const { view } = editor;
      const { doc } = view.state;
      const allBlockEls = Array.from(view.dom.children) as HTMLElement[];
      const sourceIdx = sourceIndexRef.current;
      if (sourceIdx < 0 || sourceIdx >= allBlockEls.length) return;

      // 跳过无意义的移动（位置不变）
      if (targetGapIndex === sourceIdx || targetGapIndex === sourceIdx + 1) return;

      const sourceBlock = allBlockEls[sourceIdx];

      // 获取源块�?ProseMirror 位置
      const $source = doc.resolve(view.posAtDOM(sourceBlock, 0));
      const sourceStart = $source.before(1);
      const sourceEnd = $source.after(1);
      const sourceNode = doc.nodeAt(sourceStart);
      if (!sourceNode) return;
      const topLevelNodes = Array.from({ length: doc.childCount }, (_, index) => doc.child(index));
      const plannedSortKey = planExplicitMoveSortKey(
        topLevelNodes,
        sourceIdx,
        targetGapIndex,
      );
      const nodeToInsert = plannedSortKey
        ? sourceNode.type.create(
            withExplicitMoveSortKeyAttrs(sourceNode.attrs, plannedSortKey),
            sourceNode.content,
            sourceNode.marks,
          )
        : sourceNode;

      // 计算插入位置：在目标 gap 位置之前
      let insertPos: number;
      if (targetGapIndex >= allBlockEls.length) {
        const $last = doc.resolve(view.posAtDOM(allBlockEls[allBlockEls.length - 1], 0));
        insertPos = $last.after(1);
      } else if (targetGapIndex <= 0) {
        const $first = doc.resolve(view.posAtDOM(allBlockEls[0], 0));
        insertPos = $first.before(1);
      } else {
        const $target = doc.resolve(view.posAtDOM(allBlockEls[targetGapIndex], 0));
        insertPos = $target.before(1);
      }

      // 两步事务：先删后插，�?mapping.mapPos 确保位置正确
      const tr = view.state.tr;
      tr.delete(sourceStart, sourceEnd);
      const mappedPos = tr.mapping.map(insertPos);
      tr.insert(mappedPos, nodeToInsert);
      view.dispatch(tr);
    } catch (err) {
      console.error('[BlockToolbar] 移动块失�?', err);
    }
  }, [editor]);

  // ---- Drag: ghost & indicator management ----
  const createGhost = useCallback((sourceBlock: HTMLElement) => {
    const ghost = sourceBlock.cloneNode(true) as HTMLElement;
    ghost.className = 'block-drag-ghost';
    ghost.style.width = sourceBlock.offsetWidth + 'px';
    document.body.appendChild(ghost);
    ghostElementRef.current = ghost;
  }, []);

  const createDropIndicator = useCallback(() => {
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.style.display = 'none';
    document.body.appendChild(indicator);
    dropIndicatorRef.current = indicator;
  }, []);

  const updateDragVisuals = useCallback((clientX: number, clientY: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();

    // 更新幽灵位置（position: fixed，直接用 viewport 坐标�?
    const ghost = ghostElementRef.current;
    if (ghost) {
      ghost.style.left = (clientX + GHOST_OFFSET_X) + 'px';
      ghost.style.top = (clientY + GHOST_OFFSET_Y) + 'px';
    }

    // 自动滚动
    const distFromTop = clientY - wrapperRect.top;
    const distFromBottom = wrapperRect.bottom - clientY;
    if (distFromTop < AUTO_SCROLL_ZONE && distFromTop >= 0) {
      const speed = Math.ceil(AUTO_SCROLL_MAX_SPEED * (1 - distFromTop / AUTO_SCROLL_ZONE));
      wrapper.scrollBy({ top: -speed, behavior: 'auto' });
    } else if (distFromBottom < AUTO_SCROLL_ZONE && distFromBottom >= 0) {
      const speed = Math.ceil(AUTO_SCROLL_MAX_SPEED * (1 - distFromBottom / AUTO_SCROLL_ZONE));
      wrapper.scrollBy({ top: speed, behavior: 'auto' });
    }

    // 计算放置目标
    const blocks = blockElementsRef.current;
    const sourceIdx = sourceIndexRef.current;

    // 光标不在编辑器区域内 �?隐藏指示�?
    if (clientY < wrapperRect.top || clientY > wrapperRect.bottom || blocks.length <= 1) {
      dropTargetIndexRef.current = -1;
      const indicator = dropIndicatorRef.current;
      if (indicator) indicator.style.display = 'none';
      return;
    }

    // 重新读取块位置（随滚动更新）
    let bestGap = -1;
    let bestDist = Infinity;
    let bestViewportY = 0;

    for (let i = 0; i <= blocks.length; i++) {
      // 跳过源块相邻的间隙（移动无意义）
      if (i === sourceIdx || i === sourceIdx + 1) continue;

      let gapViewportY: number;
      if (i === 0) {
        const rect = blocks[0].getBoundingClientRect();
        gapViewportY = rect.top;
      } else if (i === blocks.length) {
        const rect = blocks[blocks.length - 1].getBoundingClientRect();
        gapViewportY = rect.bottom;
      } else {
        const prevRect = blocks[i - 1].getBoundingClientRect();
        const nextRect = blocks[i].getBoundingClientRect();
        gapViewportY = (prevRect.bottom + nextRect.top) / 2;
      }

      const dist = Math.abs(clientY - gapViewportY);
      if (dist < bestDist) {
        bestDist = dist;
        bestGap = i;
        bestViewportY = gapViewportY;
      }
    }

    if (bestGap >= 0) {
      dropTargetIndexRef.current = bestGap;
      const indicator = dropIndicatorRef.current;
      if (indicator) {
        indicator.style.display = '';
        indicator.style.top = bestViewportY + 'px';
        indicator.style.left = wrapperRect.left + 'px';
        indicator.style.width = wrapperRect.width + 'px';
      }
    } else {
      dropTargetIndexRef.current = -1;
    }
  }, [wrapperRef]);

  const cleanupDrag = useCallback(() => {
    // 移除幽灵
    ghostElementRef.current?.remove();
    ghostElementRef.current = null;
    // 移除指示�?
    dropIndicatorRef.current?.remove();
    dropIndicatorRef.current = null;
    // 恢复 body
    document.body.classList.remove('block-dragging');
    // 恢复源块
    if (dragSourceRef.current) {
      dragSourceRef.current.style.opacity = '';
    }
    // 清理 rAF
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // 重置 refs
    isDraggingRef.current = false;
    isDraggingActiveRef.current = false;
    dragStartRef.current = null;
    dragSourceRef.current = null;
    blockElementsRef.current = [];
    sourceIndexRef.current = -1;
    dropTargetIndexRef.current = -1;
  }, []);

  // ---- Drag: mousedown handler ----
  const handleHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // 防止 ProseMirror 文本选择
    if (!hoveredBlock || !editor) return;

    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragSourceRef.current = hoveredBlock;

    const onMouseMove = (me: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;

      if (!isDraggingRef.current) {
        const dx = me.clientX - start.x;
        const dy = me.clientY - start.y;
        if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) return;

        // 开始拖�?
        isDraggingRef.current = true;
        isDraggingActiveRef.current = true;

        // 关闭菜单
        setMenuState('closed');

        // 缓存所有块元素
        const blocks = Array.from(editor.view.dom.children) as HTMLElement[];
        blockElementsRef.current = blocks;
        sourceIndexRef.current = blocks.indexOf(dragSourceRef.current!);

        // 创建幽灵和指示线
        if (dragSourceRef.current) {
          createGhost(dragSourceRef.current);
          createDropIndicator();
          dragSourceRef.current.style.opacity = '0.3';
        }

        document.body.classList.add('block-dragging');
      }

      // rAF 节流更新视觉
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        updateDragVisuals(me.clientX, me.clientY);
      });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (isDraggingRef.current) {
        const targetIdx = dropTargetIndexRef.current;
        if (targetIdx >= 0) {
          moveBlock(targetIdx);
        }
        cleanupDrag();
        justDraggedRef.current = true;
      } else {
        dragStartRef.current = null;
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [hoveredBlock, editor, createGhost, createDropIndicator, updateDragVisuals, moveBlock, cleanupDrag]);

  const handleHandleClick = useCallback(() => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (menuState === 'open') {
      closeMenu();
    } else {
      openMenu();
    }
  }, [menuState, closeMenu, openMenu]);

  // 拖拽结束时确保恢�?
  useEffect(() => {
    return () => {
      if (isDraggingRef.current) {
        cleanupDrag();
      }
    };
  }, [cleanupDrag]);

  if (!editor || !ready || !hoveredBlock) return null;

  return (
    <div
      className={`block-handle-wrapper${shouldAnimate ? ' block-handle-wrapper--animate' : ''}`}
      style={{ top: position.top, left: position.left }}
      onMouseEnter={handleKeepVisible}
    >
      <BlockHandle onClick={handleHandleClick} onMouseDown={handleHandleMouseDown} />
      {menuVisible && (
        <div
          ref={menuAnchorRef}
          className={`block-menu-anchor${menuState === 'closing' ? ' block-menu-anchor--closing' : ''}`}
          onAnimationEnd={() => {
            if (menuState === 'closing') setMenuState('closed');
          }}
        >
          <BlockMenu
            onClose={closeMenu}
            hoveredBlock={hoveredBlock}
            hoveredTableCell={hoveredTableCell}
            onWillDeleteBlock={handleWillDeleteBlock}
          />
        </div>
      )}
    </div>
  );
}
