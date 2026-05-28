import { useMemo, useCallback } from 'react';
import { Menu, message } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, ClearOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { TextSelection } from '@tiptap/pm/state';
import { useMarkdownEditor } from '../EditorContext';
import { getTableElementFromToolbarTarget } from './blockTarget';
import { createBlockMenuItems, getHeadingAnchorIdFromBlock } from './blockMenuItems';
import { buildAnchorUrl } from '../utils/anchorId';

interface BlockMenuProps {
  onClose: () => void;
  hoveredBlock: HTMLElement | null;
  hoveredTableCell?: HTMLTableCellElement | null;
  onWillDeleteBlock?: (fallbackBlock: HTMLElement | null) => void;
}

function getPMDepth(
  el: HTMLElement,
  view: import('prosemirror-view').EditorView
): number {
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(el, 0));
    return Math.max(1, $pos.depth);
  } catch {
    if (el.tagName === 'LI' || el.dataset.type === 'taskItem') return 2;
    return 1;
  }
}

function getBlockRange(
  el: HTMLElement,
  view: import('prosemirror-view').EditorView
): { from: number; to: number; depth: number } | null {
  try {
    const { doc } = view.state;
    const $pos = doc.resolve(view.posAtDOM(el, 0));
    const depth = Math.min(getPMDepth(el, view), $pos.depth);
    if (depth < 1) return null;
    return { from: $pos.before(depth), to: $pos.after(depth), depth };
  } catch (error) {
    console.error('[BlockMenu] resolve block range failed:', error);
    return null;
  }
}

function getTopLevelAncestor(
  el: HTMLElement,
  editorDom: Element
): HTMLElement {
  let cur: HTMLElement = el;
  while (cur.parentElement && cur.parentElement !== editorDom) {
    cur = cur.parentElement;
  }
  return cur;
}

function getDeleteFallbackBlock(
  block: HTMLElement,
  view: import('prosemirror-view').EditorView,
): HTMLElement | null {
  const depth = getPMDepth(block, view);
  const topLevel = getTopLevelAncestor(block, view.dom);
  const deleteTarget =
    depth > 1 && block.parentElement && block.parentElement.children.length <= 1
      ? block.parentElement
      : block;

  return (
    (deleteTarget.nextElementSibling as HTMLElement | null) ??
    (deleteTarget.previousElementSibling as HTMLElement | null) ??
    (topLevel.nextElementSibling as HTMLElement | null) ??
    (topLevel.previousElementSibling as HTMLElement | null)
  );
}

export function BlockMenu({ onClose, hoveredBlock, hoveredTableCell, onWillDeleteBlock }: BlockMenuProps) {
  const editor = useMarkdownEditor();
  const tableElement = useMemo(
    () => getTableElementFromToolbarTarget(hoveredBlock),
    [hoveredBlock],
  );
  const isTableTarget = Boolean(tableElement);
  const headingAnchorId = useMemo(
    () => getHeadingAnchorIdFromBlock(hoveredBlock),
    [hoveredBlock],
  );

  const canMoveUp = useMemo(() => {
    if (!editor || !hoveredBlock || isTableTarget) return false;
    const depth = getPMDepth(hoveredBlock, editor.view);
    const topLevel = getTopLevelAncestor(hoveredBlock, editor.view.dom);
    if (depth > 1) {
      return (
        hoveredBlock.previousElementSibling !== null ||
        topLevel.previousElementSibling !== null
      );
    }
    return topLevel.previousElementSibling !== null;
  }, [editor, hoveredBlock, isTableTarget]);

  const canMoveDown = useMemo(() => {
    if (!editor || !hoveredBlock || isTableTarget) return false;
    const depth = getPMDepth(hoveredBlock, editor.view);
    const topLevel = getTopLevelAncestor(hoveredBlock, editor.view.dom);
    if (depth > 1) {
      return (
        hoveredBlock.nextElementSibling !== null ||
        topLevel.nextElementSibling !== null
      );
    }
    return topLevel.nextElementSibling !== null;
  }, [editor, hoveredBlock, isTableTarget]);

  const deleteBlock = useCallback(async () => {
    if (!editor || !hoveredBlock) return;
    const { view } = editor;
    const { doc } = view.state;
    const range = getBlockRange(hoveredBlock, view);
    if (!range) return;
    const blockId = hoveredBlock.dataset.blockId;
    onWillDeleteBlock?.(getDeleteFallbackBlock(hoveredBlock, view));

    if (range.depth > 1 && hoveredBlock.parentElement &&
        hoveredBlock.parentElement.children.length <= 1) {
      const parentRange = getBlockRange(hoveredBlock.parentElement, view);
      if (parentRange) {
        view.dispatch(view.state.tr.delete(parentRange.from, parentRange.to));
      }
    } else if (view.state.doc.childCount <= 1) {
      view.dispatch(
        view.state.tr
          .delete(0, doc.content.size)
          .insert(0, view.state.schema.nodes.paragraph.create())
      );
    } else {
      view.dispatch(view.state.tr.delete(range.from, range.to));
    }

    if (blockId) {
      message.success('块已删除，等待自动同步');
    }
  }, [editor, hoveredBlock, onWillDeleteBlock]);

  const copyBlock = useCallback(async () => {
    if (!hoveredBlock) return;
    const html = hoveredBlock.outerHTML;
    const text = hoveredBlock.textContent || '';
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
  }, [hoveredBlock]);

  const copyAnchorLink = useCallback(async () => {
    if (!headingAnchorId) return;

    const url = buildAnchorUrl(window.location.href, headingAnchorId);
    window.history.replaceState(null, '', url);

    try {
      await navigator.clipboard.writeText(url);
      message.success('锚点链接已复制');
    } catch {
      message.warning('复制锚点链接失败');
    }
  }, [headingAnchorId]);

  const clearFormat = useCallback(() => {
    if (!editor || !hoveredBlock || isTableTarget) return;
    const { view } = editor;
    const range = getBlockRange(hoveredBlock, view);
    if (!range) return;
    const text = hoveredBlock.textContent || '';
    const paragraph = view.state.schema.nodes.paragraph.create(
      null, text ? view.state.schema.text(text) : undefined
    );
    view.dispatch(view.state.tr.replaceWith(range.from, range.to, paragraph));
  }, [editor, hoveredBlock, isTableTarget]);

  const insertParagraph = useCallback((where: 'above' | 'below') => {
    if (!editor || !hoveredBlock || isTableTarget) return;
    const { view } = editor;
    const range = getBlockRange(hoveredBlock, view);
    if (!range) return;
    const paragraph = view.state.schema.nodes.paragraph.create();
    const insertAt = where === 'above' ? range.from : range.to;
    try {
      view.dispatch(view.state.tr.insert(insertAt, paragraph));
    } catch (error) {
      console.error('[BlockMenu] insert paragraph failed:', error);
      message.warning('当前位置暂不支持插入普通段落');
    }
  }, [editor, hoveredBlock, isTableTarget]);

  const swapBlocks = useCallback((direction: 'up' | 'down') => {
    if (!editor || !hoveredBlock || isTableTarget) return;
    const { view } = editor;
    const { state } = view;
    const { doc } = state;
    const depth = getPMDepth(hoveredBlock, view);
    const topLevel = getTopLevelAncestor(hoveredBlock, view.dom);

    if (depth > 1) {
      const sibling = (direction === 'up'
        ? hoveredBlock.previousElementSibling
        : hoveredBlock.nextElementSibling) as HTMLElement | null;

      if (sibling) {
        try {
          const hoveredRange = getBlockRange(hoveredBlock, view);
          const siblingRange = getBlockRange(sibling, view);
          if (!hoveredRange || !siblingRange) return;

          const [startA, , startB, endB] = hoveredRange.from < siblingRange.from
            ? [hoveredRange.from, hoveredRange.to, siblingRange.from, siblingRange.to]
            : [siblingRange.from, siblingRange.to, hoveredRange.from, hoveredRange.to];

          const nodeA = doc.nodeAt(startA);
          const nodeB = doc.nodeAt(startB);
          if (nodeA && nodeB) {
            view.dispatch(state.tr.replaceWith(startA, endB, [nodeB, nodeA]));
            return;
          }
        } catch (err) {
          console.error('[BlockMenu] move nested block failed:', err);
        }
      }
    }

    const targetTop = (direction === 'up'
      ? topLevel.previousElementSibling
      : topLevel.nextElementSibling) as HTMLElement | null;
    if (!targetTop) return;

    try {
      const hoveredRange = getBlockRange(topLevel, view);
      const targetRange = getBlockRange(targetTop, view);
      if (!hoveredRange || !targetRange) return;

      const [startA, , startB, endB] = hoveredRange.from < targetRange.from
        ? [hoveredRange.from, hoveredRange.to, targetRange.from, targetRange.to]
        : [targetRange.from, targetRange.to, hoveredRange.from, hoveredRange.to];

      const nodeA = doc.nodeAt(startA);
      const nodeB = doc.nodeAt(startB);
      if (nodeA && nodeB) {
        view.dispatch(state.tr.replaceWith(startA, endB, [nodeB, nodeA]));
      }
    } catch (err) {
      console.error('[BlockMenu] move top-level block failed:', err);
    }
  }, [editor, hoveredBlock, isTableTarget]);

  const focusTableCell = useCallback(() => {
    if (!editor || !tableElement) return;
    const cell = hoveredTableCell ?? tableElement.querySelector<HTMLTableCellElement>('td,th');
    if (!cell) return;

    try {
      const { view } = editor;
      const pos = view.posAtDOM(cell, 0);
      const safePos = Math.min(pos + 1, view.state.doc.content.size);
      const selection = TextSelection.near(view.state.doc.resolve(safePos));
      view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
    } catch (error) {
      console.error('[BlockMenu] focus table cell failed:', error);
      editor.commands.focus();
    }
  }, [editor, tableElement, hoveredTableCell]);

  const runTableCommand = useCallback((key: string) => {
    if (!editor || !tableElement) return;
    focusTableCell();

    const chain = editor.chain().focus();
    switch (key) {
      case 'addRowBefore': chain.addRowBefore().run(); break;
      case 'addRowAfter': chain.addRowAfter().run(); break;
      case 'deleteRow': chain.deleteRow().run(); break;
      case 'addColumnBefore': chain.addColumnBefore().run(); break;
      case 'addColumnAfter': chain.addColumnAfter().run(); break;
      case 'deleteColumn': chain.deleteColumn().run(); break;
      case 'mergeCells': chain.mergeCells().run(); break;
      case 'splitCell': chain.splitCell().run(); break;
      case 'toggleHeaderRow': chain.toggleHeaderRow().run(); break;
      case 'deleteTable': chain.deleteTable().run(); break;
      default: break;
    }
  }, [editor, tableElement, focusTableCell]);

  const blockItems: MenuProps['items'] = useMemo(() => (
    createBlockMenuItems({
      canMoveUp,
      canMoveDown,
      headingAnchorId,
    })
  ), [canMoveUp, canMoveDown, headingAnchorId]);

  const tableItems: MenuProps['items'] = useMemo(() => [
    { key: 'addRowBefore', icon: <PlusCircleOutlined />, label: '上方插入行' },
    { key: 'addRowAfter', icon: <PlusCircleOutlined />, label: '下方插入行' },
    { key: 'deleteRow', icon: <DeleteOutlined />, label: '删除当前行' },
    { type: 'divider' },
    { key: 'addColumnBefore', icon: <PlusCircleOutlined />, label: '左侧插入列' },
    { key: 'addColumnAfter', icon: <PlusCircleOutlined />, label: '右侧插入列' },
    { key: 'deleteColumn', icon: <DeleteOutlined />, label: '删除当前列' },
    { type: 'divider' },
    { key: 'mergeCells', icon: <ClearOutlined />, label: '合并单元格' },
    { key: 'splitCell', icon: <ClearOutlined />, label: '拆分单元格' },
    { key: 'toggleHeaderRow', icon: <ClearOutlined />, label: '切换表头行' },
    { type: 'divider' },
    { key: 'deleteTable', icon: <DeleteOutlined />, danger: true, label: '删除表格' },
  ], []);

  const items = isTableTarget ? tableItems : blockItems;

  const handleClick: MenuProps['onClick'] = useCallback(({ key }: { key: string }) => {
    if (isTableTarget) {
      runTableCommand(key);
      onClose();
      return;
    }

    switch (key) {
      case 'delete':   void deleteBlock(); break;
      case 'copy':     void copyBlock(); break;
      case 'cut':      void copyBlock().then(() => deleteBlock()); break;
      case 'copyAnchorLink': void copyAnchorLink(); break;
      case 'clear':    clearFormat(); break;
      case 'addAbove': insertParagraph('above'); break;
      case 'addBelow': insertParagraph('below'); break;
      case 'moveUp':   swapBlocks('up'); break;
      case 'moveDown': swapBlocks('down'); break;
      default: console.log(`[BlockMenu] clicked: ${key}`);
    }
    onClose();
  }, [isTableTarget, runTableCommand, onClose, deleteBlock, copyBlock, copyAnchorLink, clearFormat, insertParagraph, swapBlocks]);

  return (
    <div className={`block-menu-popover${isTableTarget ? ' block-menu-popover--table' : ''}`}>
      <Menu
        items={items}
        onClick={handleClick}
        selectable={false}
        style={{ border: 'none', borderRadius: 6 }}
      />
    </div>
  );
}
