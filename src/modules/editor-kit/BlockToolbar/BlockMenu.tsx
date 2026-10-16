import { useMemo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { message } from 'antd';
import { TextSelection } from '@tiptap/pm/state';
import { useMarkdownEditor, useMarkdownEditorContext } from '../EditorContext';
import { getTableElementFromToolbarTarget, getTopLevelBlockRange } from './blockTarget';
import { getHeadingAnchorIdFromBlock } from './blockMenuItems';
import { buildAnchorUrl } from '../utils/anchorId';
import { runInsertCard } from './blockInsertContent';
import BlockInsertPanel, { type InsertCardId, type InsertCardOptions } from './BlockInsertPanel';
import YuqueIcon, { type YuqueIconName } from '../Toolbar/icons/YuqueIcon';

interface BlockMenuProps {
  /** menu：块操作菜单（默认）；insert：空段落「+」打开的插入面板（插入到下方） */
  mode?: 'menu' | 'insert';
  /** 块手柄元素，菜单相对它定位 */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  hoveredBlock: HTMLElement | null;
  hoveredTableCell?: HTMLTableCellElement | null;
  onWillDeleteBlock?: (fallbackBlock: HTMLElement | null) => void;
}

function getPMDepth(el: HTMLElement, view: import('prosemirror-view').EditorView): number {
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
  view: import('prosemirror-view').EditorView,
): { from: number; to: number; depth: number } | null {
  const topLevel = getTopLevelBlockRange(view, el);
  if (topLevel) return { from: topLevel.from, to: topLevel.to, depth: 1 };
  try {
    const { doc } = view.state;
    const $pos = doc.resolve(view.posAtDOM(el, 0));
    const depth = Math.min(getPMDepth(el, view), $pos.depth);
    if (depth >= 1) {
      const range = { from: $pos.before(depth), to: $pos.after(depth), depth };
      // 校验解析出的节点确实对应该元素；NodeView 内部元素（如代码块的 pre）会解析到相邻块
      const nodeDom = view.nodeDOM(range.from);
      if (nodeDom instanceof Node && (nodeDom === el || nodeDom.contains(el))) return range;
    }
  } catch (error) {
    console.error('[BlockMenu] resolve block range failed:', error);
  }
  // 兜底：按所在顶层块计算
  const top = getTopLevelAncestor(el, view.dom);
  const fallback = getTopLevelBlockRange(view, top);
  return fallback ? { from: fallback.from, to: fallback.to, depth: 1 } : null;
}

function getTopLevelAncestor(el: HTMLElement, editorDom: Element): HTMLElement {
  let cur: HTMLElement = el;
  while (cur.parentElement && cur.parentElement !== editorDom) {
    cur = cur.parentElement;
  }
  return cur;
}

type ConvertTarget =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'codeBlock'
  | 'highlightBlock'
  | 'blockquote';

// 语雀「转化为」面板：上方 6 列图标网格，下方两列卡片
const CONVERT_ICONS: Array<{ key: ConvertTarget; label: string; icon: YuqueIconName }> = [
  { key: 'heading1', label: '标题 1', icon: 'card-h1' },
  { key: 'heading2', label: '标题 2', icon: 'card-h2' },
  { key: 'heading3', label: '标题 3', icon: 'card-h3' },
  { key: 'heading4', label: '标题 4', icon: 'card-h4' },
  { key: 'heading5', label: '标题 5', icon: 'card-h5' },
  { key: 'heading6', label: '标题 6', icon: 'card-h6' },
  { key: 'paragraph', label: '正文', icon: 'EditorFontsize' },
  { key: 'orderedList', label: '有序列表', icon: 't-order-list' },
  { key: 'bulletList', label: '无序列表', icon: 't-unorder-list' },
  { key: 'taskList', label: '任务列表', icon: 't-task-list' },
  { key: 'codeBlock', label: '代码块', icon: 'EditorCodeblock' },
];

const CONVERT_CARDS: Array<{ key: ConvertTarget; label: string; icon: YuqueIconName }> = [
  { key: 'highlightBlock', label: '高亮块', icon: 'EditorMainHighlightBlock' },
  { key: 'blockquote', label: '引用', icon: 'EditorMainReference' },
];

/** 当前块对应的「转化为」类型，用于高亮 */
function detectConvertTarget(block: HTMLElement | null): ConvertTarget | null {
  if (!block) return null;
  const tag = block.tagName;
  if (tag === 'P') return 'paragraph';
  const heading = /^H([1-6])$/.exec(tag);
  if (heading) return `heading${heading[1]}` as ConvertTarget;
  if (tag === 'OL') return 'orderedList';
  if (tag === 'UL') return block.dataset.type === 'taskList' ? 'taskList' : 'bulletList';
  if (tag === 'BLOCKQUOTE') return 'blockquote';
  if (tag === 'PRE' || block.dataset.type === 'codeBlock' || block.querySelector(':scope > pre')) return 'codeBlock';
  return null;
}

const CONVERTIBLE_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE']);

type SubmenuKey = 'turnInto' | 'indent' | 'addBelow';

type BrickMenuEntry =
  | '|'
  | {
      key: string;
      icon: YuqueIconName;
      label: string;
      submenu?: SubmenuKey;
      disabled?: boolean;
      onClick?: () => void;
    };

const VIEWPORT_GAP = 8;

function BrickItem({
  entry,
  open,
  onEnter,
  onSelect,
}: {
  entry: Exclude<BrickMenuEntry, '|'>;
  open?: boolean;
  onEnter?: (element: HTMLElement) => void;
  onSelect: (element: HTMLElement) => void;
}) {
  return (
    <div
      className={`yq-brick-item${open ? ' is-open' : ''}${entry.disabled ? ' is-disabled' : ''}`}
      data-action={entry.key}
      data-testid={`brick-menu-${entry.key}`}
      onMouseEnter={(event) => onEnter?.(event.currentTarget)}
      onClick={(event) => {
        if (entry.disabled) return;
        onSelect(event.currentTarget);
      }}
    >
      <YuqueIcon name={entry.icon} className="yq-brick-item__icon" />
      <span className="yq-brick-item__text">{entry.label}</span>
      {entry.submenu && <YuqueIcon name="ArrowRight" className="yq-brick-item__arrow" />}
    </div>
  );
}

export function BlockMenu({
  mode = 'menu',
  anchorRef,
  onClose,
  hoveredBlock,
  hoveredTableCell,
  onWillDeleteBlock,
}: BlockMenuProps) {
  const editor = useMarkdownEditor();
  const { uploadImage } = useMarkdownEditorContext();
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const submenuHideTimerRef = useRef<number | null>(null);
  const submenuItemRef = useRef<HTMLElement | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuKey | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [subPos, setSubPos] = useState<{ key: SubmenuKey; left: number; top: number } | null>(null);

  const tableElement = useMemo(() => getTableElementFromToolbarTarget(hoveredBlock), [hoveredBlock]);
  const isTableTarget = Boolean(tableElement);
  const headingAnchorId = useMemo(() => getHeadingAnchorIdFromBlock(hoveredBlock), [hoveredBlock]);

  /* ---------------- 定位：菜单右缘对齐手柄右缘，位于手柄下方 4px；放不下时翻到上方 ---------------- */
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const a = anchor.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      let left = mode === 'insert' ? a.left : a.right - width;
      left = Math.max(VIEWPORT_GAP, Math.min(left, window.innerWidth - width - VIEWPORT_GAP));
      let top = a.bottom + 4;
      if (top + height > window.innerHeight - VIEWPORT_GAP) {
        top = Math.max(VIEWPORT_GAP, a.top - 4 - height);
      }
      setMenuPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, mode, isTableTarget]);

  /* ---------------- 子菜单：出现在菜单右侧 4px，垂直居中于菜单项并限制在视口内 ---------------- */
  useLayoutEffect(() => {
    if (!activeSubmenu) return;
    const item = submenuItemRef.current;
    const menu = menuRef.current;
    const sub = subRef.current;
    if (!item || !menu || !sub) return;
    const itemRect = item.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const width = sub.offsetWidth;
    const height = sub.offsetHeight;
    let left = menuRect.right + 4;
    if (left + width > window.innerWidth - VIEWPORT_GAP) left = menuRect.left - 4 - width;
    const centered = itemRect.top + itemRect.height / 2 - height / 2;
    const top = Math.max(VIEWPORT_GAP, Math.min(centered, window.innerHeight - height - VIEWPORT_GAP));
    setSubPos({ key: activeSubmenu, left, top });
  }, [activeSubmenu, menuPos]);

  const clearSubmenuHideTimer = useCallback(() => {
    if (submenuHideTimerRef.current) {
      window.clearTimeout(submenuHideTimerRef.current);
      submenuHideTimerRef.current = null;
    }
  }, []);

  const scheduleCloseSubmenu = useCallback(() => {
    clearSubmenuHideTimer();
    submenuHideTimerRef.current = window.setTimeout(() => {
      setActiveSubmenu(null);
      submenuHideTimerRef.current = null;
    }, 150);
  }, [clearSubmenuHideTimer]);

  const openSubmenu = useCallback((key: SubmenuKey, itemElement: HTMLElement) => {
    clearSubmenuHideTimer();
    submenuItemRef.current = itemElement;
    setActiveSubmenu(key);
  }, [clearSubmenuHideTimer]);

  /* ---------------- 块操作 ---------------- */
  const deleteBlock = useCallback(async () => {
    if (!editor || !hoveredBlock) return;
    const { view } = editor;
    const { doc } = view.state;
    const range = getBlockRange(hoveredBlock, view);
    if (!range) return;

    const blockRect = hoveredBlock.getBoundingClientRect();
    const centerX = blockRect.left + blockRect.width / 2;
    const centerY = blockRect.top + blockRect.height / 2;

    const tr = view.state.tr;
    if (range.depth > 1 && hoveredBlock.parentElement && hoveredBlock.parentElement.children.length <= 1) {
      const parentRange = getBlockRange(hoveredBlock.parentElement, view);
      if (parentRange) tr.delete(parentRange.from, parentRange.to);
    } else if (view.state.doc.childCount <= 1) {
      tr.delete(0, doc.content.size).insert(0, view.state.schema.nodes.paragraph.create());
    } else {
      tr.delete(range.from, range.to);
    }
    view.dispatch(tr);

    // 删除后按映射位置 / 原坐标找到相邻块，供手柄重新定位
    let fallbackEl: HTMLElement | null = null;
    try {
      const mappedPos = tr.mapping.map(range.from);
      const clampedPos = Math.min(mappedPos, view.state.doc.content.size);
      const $mapped = view.state.doc.resolve(clampedPos);
      if ($mapped.depth >= 1) {
        const topLevelPos = $mapped.before(1);
        if (view.state.doc.nodeAt(topLevelPos)) {
          const domNode = view.nodeDOM(topLevelPos);
          fallbackEl = domNode instanceof HTMLElement ? domNode : ((domNode as Node)?.parentElement as HTMLElement | null);
        }
      }
    } catch {
      // 位置映射失败时用坐标兜底
    }
    if (!fallbackEl || !view.dom.contains(fallbackEl)) {
      const domEl = document.elementFromPoint(centerX, centerY);
      if (domEl && view.dom.contains(domEl)) {
        const el = domEl instanceof HTMLElement ? domEl : domEl.parentElement;
        fallbackEl = el ? getTopLevelAncestor(el, view.dom) : null;
      }
    }
    if (!fallbackEl || fallbackEl === (view.dom as HTMLElement)) {
      fallbackEl = view.dom.firstElementChild as HTMLElement | null;
    }
    onWillDeleteBlock?.(fallbackEl);
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

  const canConvert = Boolean(hoveredBlock && CONVERTIBLE_TAGS.has(hoveredBlock.tagName) && !isTableTarget);
  const currentConvertTarget = useMemo(() => detectConvertTarget(hoveredBlock), [hoveredBlock]);

  // 转化：先把列表/引用拆回段落，再应用目标类型
  const convertBlock = useCallback((target: ConvertTarget) => {
    if (!editor || !hoveredBlock || !canConvert) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    const from = Math.min(range.from + 1, editor.state.doc.content.size);
    const to = Math.max(from, range.to - 1);
    const tag = hoveredBlock.tagName;
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (tag === 'UL' && hoveredBlock.dataset.type === 'taskList') chain.toggleTaskList();
    else if (tag === 'UL') chain.toggleBulletList();
    else if (tag === 'OL') chain.toggleOrderedList();
    else if (tag === 'BLOCKQUOTE') chain.lift('blockquote');

    switch (target) {
      case 'paragraph': chain.setParagraph(); break;
      case 'heading1': chain.setNode('heading', { level: 1 }); break;
      case 'heading2': chain.setNode('heading', { level: 2 }); break;
      case 'heading3': chain.setNode('heading', { level: 3 }); break;
      case 'heading4': chain.setNode('heading', { level: 4 }); break;
      case 'heading5': chain.setNode('heading', { level: 5 }); break;
      case 'heading6': chain.setNode('heading', { level: 6 }); break;
      case 'bulletList': chain.setParagraph().toggleBulletList(); break;
      case 'orderedList': chain.setParagraph().toggleOrderedList(); break;
      case 'taskList': chain.setParagraph().toggleTaskList(); break;
      case 'blockquote': chain.setParagraph().wrapIn('blockquote'); break;
      case 'codeBlock': chain.setNode('codeBlock'); break;
      case 'highlightBlock': chain.toggleHighlightBlockFromSelection(); break;
      default: break;
    }
    chain.run();
  }, [editor, hoveredBlock, canConvert]);

  const runIndent = useCallback((direction: 'indent' | 'outdent') => {
    if (!editor || !hoveredBlock) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    const pos = Math.min(range.from + 1, editor.state.doc.content.size);
    const chain = editor.chain().focus().setTextSelection(pos);
    if (direction === 'indent') chain.indent().run();
    else chain.outdent().run();
  }, [editor, hoveredBlock]);

  const insertCardBelow = useCallback((id: InsertCardId, options?: InsertCardOptions) => {
    if (!editor || !hoveredBlock) return;
    if (id === 'image') {
      if (!uploadImage) {
        message.error('未选择工作空间');
        return;
      }
      imageInputRef.current?.click();
      return;
    }
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    runInsertCard(editor, id, options, range.to);
    onClose();
  }, [editor, hoveredBlock, onClose, uploadImage]);

  const handleImageFile = useCallback(async (file: File) => {
    if (!editor || !uploadImage || !hoveredBlock) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    try {
      const image = await uploadImage(file);
      editor
        .chain()
        .focus()
        .insertContentAt(range.to, {
          type: 'imageBlock',
          attrs: {
            imageId: image.imageId,
            src: image.publicUrl || image.url,
            filename: image.filename,
            mimeType: image.mimeType,
            size: image.size,
            naturalWidth: image.width,
            naturalHeight: image.height,
            width: image.width,
            height: image.height,
            alt: image.filename,
          },
        })
        .run();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
  }, [editor, hoveredBlock, onClose, uploadImage]);

  /* ---------------- 表格 ---------------- */
  const focusTableCell = useCallback(() => {
    if (!editor || !tableElement) return;
    const cell = hoveredTableCell ?? tableElement.querySelector<HTMLTableCellElement>('td,th');
    if (!cell) return;
    try {
      const { view } = editor;
      const pos = view.posAtDOM(cell, 0);
      const safePos = Math.min(pos + 1, view.state.doc.content.size);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(safePos))));
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

  const tableEntries: BrickMenuEntry[] = [
    { key: 'addRowBefore', icon: 'Add', label: '上方插入行', onClick: () => runTableCommand('addRowBefore') },
    { key: 'addRowAfter', icon: 'Add', label: '下方插入行', onClick: () => runTableCommand('addRowAfter') },
    { key: 'deleteRow', icon: 'c-tb-delete', label: '删除当前行', onClick: () => runTableCommand('deleteRow') },
    '|',
    { key: 'addColumnBefore', icon: 'Add', label: '左侧插入列', onClick: () => runTableCommand('addColumnBefore') },
    { key: 'addColumnAfter', icon: 'Add', label: '右侧插入列', onClick: () => runTableCommand('addColumnAfter') },
    { key: 'deleteColumn', icon: 'c-tb-delete', label: '删除当前列', onClick: () => runTableCommand('deleteColumn') },
    '|',
    { key: 'mergeCells', icon: 'EditorMainTable', label: '合并单元格', onClick: () => runTableCommand('mergeCells') },
    { key: 'splitCell', icon: 'EditorMainTable', label: '拆分单元格', onClick: () => runTableCommand('splitCell') },
    { key: 'toggleHeaderRow', icon: 'EditorMainTable', label: '切换表头行', onClick: () => runTableCommand('toggleHeaderRow') },
    '|',
    { key: 'deleteTable', icon: 'c-tb-delete', label: '删除表格', onClick: () => runTableCommand('deleteTable') },
  ];

  // 语雀块菜单：转化为 | 删除 复制 剪切 | 缩进 (复制链接) | 在下方添加
  const brickEntries: BrickMenuEntry[] = [
    ...(canConvert
      ? ([{ key: 'turnInto', icon: 'Change', label: '转化为', submenu: 'turnInto' }, '|'] as BrickMenuEntry[])
      : []),
    { key: 'delete', icon: 'c-tb-delete', label: '删除', onClick: () => void deleteBlock() },
    { key: 'copy', icon: 'c-tb-copy', label: '复制', onClick: () => void copyBlock() },
    { key: 'cut', icon: 'cut', label: '剪切', onClick: () => void copyBlock().then(() => deleteBlock()) },
    '|',
    { key: 'indent', icon: 'EditorIndent', label: '缩进', submenu: 'indent' },
    ...(headingAnchorId
      ? ([{ key: 'copyLink', icon: 'NeCTbCopyLink', label: '复制链接', onClick: () => void copyAnchorLink() }] as BrickMenuEntry[])
      : []),
    '|',
    { key: 'addBelow', icon: 'Add', label: '在下方添加', submenu: 'addBelow' },
  ];

  const imageInput = (
    <input
      ref={imageInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void handleImageFile(file);
      }}
    />
  );

  const renderEntries = (entries: BrickMenuEntry[], withSubmenus: boolean) =>
    entries.map((entry, index) => {
      if (entry === '|') return <div key={`divider-${index}`} className="yq-brick-divider" />;
      return (
        <BrickItem
          key={entry.key}
          entry={entry}
          open={Boolean(entry.submenu && activeSubmenu === entry.submenu)}
          onEnter={(element) => {
            if (!withSubmenus) return;
            if (entry.submenu) openSubmenu(entry.submenu, element);
            else scheduleCloseSubmenu();
          }}
          onSelect={(element) => {
            if (entry.submenu) {
              openSubmenu(entry.submenu, element);
              return;
            }
            entry.onClick?.();
            onClose();
          }}
        />
      );
    });

  let submenuContent: ReactNode = null;
  if (activeSubmenu === 'turnInto') {
    submenuContent = (
      <div className="yq-turn-into">
        <div className="yq-turn-into__icons">
          {CONVERT_ICONS.map((item) => (
            <div
              key={item.key}
              title={item.label}
              aria-label={item.label}
              data-testid={`turn-into-${item.key}`}
              className={`yq-turn-into__icon${currentConvertTarget === item.key ? ' is-selected' : ''}`}
              onClick={() => {
                convertBlock(item.key);
                onClose();
              }}
            >
              <YuqueIcon name={item.icon} />
            </div>
          ))}
        </div>
        <div className="yq-turn-into__cards">
          {CONVERT_CARDS.map((item) => (
            <div
              key={item.key}
              data-testid={`turn-into-${item.key}`}
              className={`yq-turn-into__card${currentConvertTarget === item.key ? ' is-selected' : ''}`}
              onClick={() => {
                convertBlock(item.key);
                onClose();
              }}
            >
              <span className="yq-turn-into__card-icon">
                <YuqueIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (activeSubmenu === 'indent') {
    submenuContent = (
      <div className="yq-brick-menu__list">
        {renderEntries(
          [
            { key: 'indent-right', icon: 'EditorIndent', label: '增加缩进', onClick: () => runIndent('indent') },
            { key: 'indent-left', icon: 'EditorOutdent', label: '减少缩进', onClick: () => runIndent('outdent') },
          ],
          false,
        )}
      </div>
    );
  } else if (activeSubmenu === 'addBelow') {
    submenuContent = <BlockInsertPanel className="yq-insert-panel--brick" onSelect={insertCardBelow} />;
  }

  const hiddenUntilPlaced: React.CSSProperties = menuPos
    ? { left: menuPos.left, top: menuPos.top }
    : { left: -9999, top: -9999, visibility: 'hidden' };

  let body: ReactNode;
  if (isTableTarget) {
    body = <div className="yq-brick-menu__list">{renderEntries(tableEntries, false)}</div>;
  } else if (mode === 'insert') {
    body = <BlockInsertPanel className="yq-insert-panel--brick" onSelect={insertCardBelow} />;
  } else {
    body = (
      <div className="yq-brick-menu__list" onMouseLeave={scheduleCloseSubmenu}>
        {renderEntries(brickEntries, true)}
      </div>
    );
  }

  return createPortal(
    <>
      {imageInput}
      <div
        ref={menuRef}
        className={`block-menu-popover ${mode === 'insert' && !isTableTarget ? 'yq-brick-insert' : 'yq-brick-menu'}`}
        style={hiddenUntilPlaced}
        onMouseDown={(event) => {
          if (!(event.target as HTMLElement).closest('input')) event.preventDefault();
        }}
      >
        {body}
      </div>
      {submenuContent && (
        <div
          ref={subRef}
          className={`block-menu-popover yq-brick-sub yq-brick-sub--${activeSubmenu}`}
          style={subPos && subPos.key === activeSubmenu ? { left: subPos.left, top: subPos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}
          onMouseEnter={clearSubmenuHideTimer}
          onMouseLeave={scheduleCloseSubmenu}
          onMouseDown={(event) => event.preventDefault()}
        >
          {submenuContent}
        </div>
      )}
    </>,
    document.body,
  );
}
