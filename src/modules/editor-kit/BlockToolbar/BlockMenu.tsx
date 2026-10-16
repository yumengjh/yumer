import { useMemo, useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Menu, message } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, ClearOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { TextSelection } from '@tiptap/pm/state';
import { useMarkdownEditor, useMarkdownEditorContext } from '../EditorContext';
import { getTableElementFromToolbarTarget } from './blockTarget';
import { getHeadingAnchorIdFromBlock } from './blockMenuItems';
import { buildAnchorUrl } from '../utils/anchorId';
import { createBlockInsertContent } from './blockInsertContent';
import type { BlockInsertType } from './blockInsertMenuItems';
import BlockInsertPanel from './BlockInsertPanel';
import YuqueIcon, { type YuqueIconName } from '../Toolbar/icons/YuqueIcon';

interface BlockMenuProps {
  /** menu：块操作菜单（默认）；insert：「+」按钮打开的插入面板（插入到下方） */
  mode?: 'menu' | 'insert';
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
  | 'blockquote'
  | 'codeBlock';

// 语雀「转换」面板：6 列图标网格
const CONVERT_ITEMS: Array<{ key: ConvertTarget; label: string; icon: YuqueIconName }> = [
  { key: 'paragraph', label: '正文', icon: 'EditorParagraph' },
  { key: 'heading1', label: '标题 1', icon: 'EditorH1' },
  { key: 'heading2', label: '标题 2', icon: 'EditorH2' },
  { key: 'heading3', label: '标题 3', icon: 'EditorH3' },
  { key: 'heading4', label: '标题 4', icon: 'EditorH4' },
  { key: 'heading5', label: '标题 5', icon: 'EditorH5' },
  { key: 'heading6', label: '标题 6', icon: 'EditorH6' },
  { key: 'orderedList', label: '有序列表', icon: 'EditorOrderedList' },
  { key: 'bulletList', label: '无序列表', icon: 'EditorUnorderedList' },
  { key: 'taskList', label: '任务列表', icon: 'EditorTaskList' },
  { key: 'blockquote', label: '引用', icon: 'EditorQuote' },
  { key: 'codeBlock', label: '代码块', icon: 'EditorCodeblock' },
];

/** 当前块对应的「转换」类型，用于高亮 */
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
      desc?: string;
      submenu?: SubmenuKey;
      onClick?: () => void;
    };

export function BlockMenu({ mode = 'menu', onClose, hoveredBlock, hoveredTableCell, onWillDeleteBlock }: BlockMenuProps) {
  const editor = useMarkdownEditor();
  const { uploadImage } = useMarkdownEditorContext();
  const menuRootRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const submenuHideTimerRef = useRef<number | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuKey | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const [pendingImageSide, setPendingImageSide] = useState<'above' | 'below' | null>(null);

  const tableElement = useMemo(
    () => getTableElementFromToolbarTarget(hoveredBlock),
    [hoveredBlock],
  );
  const isTableTarget = Boolean(tableElement);
  const headingAnchorId = useMemo(
    () => getHeadingAnchorIdFromBlock(hoveredBlock),
    [hoveredBlock],
  );

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
    const menuRect = menuRootRef.current?.getBoundingClientRect();
    const itemRect = itemElement.getBoundingClientRect();
    if (menuRect) setSubmenuTop(Math.max(0, itemRect.top - menuRect.top - 8));
    setActiveSubmenu(key);
  }, [clearSubmenuHideTimer]);

  const deleteBlock = useCallback(async () => {
    if (!editor || !hoveredBlock) return;
    const { view } = editor;
    const { doc } = view.state;
    const range = getBlockRange(hoveredBlock, view);
    if (!range) return;

    // Remember the block's viewport position BEFORE delete for fallback resolution
    const blockRect = hoveredBlock.getBoundingClientRect();
    const centerX = blockRect.left + blockRect.width / 2;
    const centerY = blockRect.top + blockRect.height / 2;

    // Execute the delete transaction
    const tr = view.state.tr;
    if (range.depth > 1 && hoveredBlock.parentElement &&
        hoveredBlock.parentElement.children.length <= 1) {
      const parentRange = getBlockRange(hoveredBlock.parentElement, view);
      if (parentRange) {
        tr.delete(parentRange.from, parentRange.to);
      }
    } else if (view.state.doc.childCount <= 1) {
      tr.delete(0, doc.content.size)
        .insert(0, view.state.schema.nodes.paragraph.create());
    } else {
      tr.delete(range.from, range.to);
    }
    view.dispatch(tr);

    // AFTER the transaction: resolve fallback using mapped position + coords fallback
    let fallbackEl: HTMLElement | null = null;
    try {
      const mappedPos = tr.mapping.map(range.from);
      const clampedPos = Math.min(mappedPos, view.state.doc.content.size);
      const $mapped = view.state.doc.resolve(clampedPos);
      if ($mapped.depth >= 1) {
        const topLevelPos = $mapped.before(1);
        const topLevelNode = view.state.doc.nodeAt(topLevelPos);
        if (topLevelNode) {
          const domNode = view.nodeDOM(topLevelPos);
          fallbackEl = domNode instanceof HTMLElement ? domNode : (domNode as Node)?.parentElement as HTMLElement | null;
        }
      }
    } catch {
      // Position mapping failed, will use coords fallback below
    }

    // If position mapping didn't find a valid element, use coordinates
    if (!fallbackEl || !view.dom.contains(fallbackEl)) {
      const domEl = document.elementFromPoint(centerX, centerY);
      if (domEl && view.dom.contains(domEl)) {
        const el = domEl instanceof HTMLElement ? domEl : domEl.parentElement;
        fallbackEl = el ? getTopLevelAncestor(el, view.dom) : null;
      }
    }

    // If still no fallback, try to find ANY top-level child in the editor
    if (!fallbackEl || fallbackEl === view.dom as HTMLElement) {
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

  // 转换：先把列表/引用拆回段落，再应用目标类型
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
      default: break;
    }
    chain.run();
  }, [editor, hoveredBlock, canConvert]);

  const insertBlock = useCallback((where: 'above' | 'below', type: BlockInsertType = 'paragraph') => {
    if (!editor || !hoveredBlock || isTableTarget) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    const insertAt = where === 'above' ? range.from : range.to;
    editor.chain().focus().insertContentAt(insertAt, createBlockInsertContent(type)).run();
  }, [editor, hoveredBlock, isTableTarget]);

  const insertTable = useCallback((where: 'above' | 'below', rows: number, cols: number) => {
    if (!editor || !hoveredBlock || isTableTarget) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    const insertAt = where === 'above' ? range.from : range.to;
    editor.chain().focus().setTextSelection(insertAt).insertTable({ rows, cols, withHeaderRow: true }).run();
  }, [editor, hoveredBlock, isTableTarget]);

  const runIndent = useCallback((direction: 'indent' | 'outdent') => {
    if (!editor || !hoveredBlock) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;
    const pos = Math.min(range.from + 1, editor.state.doc.content.size);
    const chain = editor.chain().focus().setTextSelection(pos);
    if (direction === 'indent') chain.indent().run();
    else chain.outdent().run();
  }, [editor, hoveredBlock]);

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

  const handleImageFile = useCallback(async (file: File) => {
    if (!editor || !uploadImage || !pendingImageSide || !hoveredBlock) return;
    const range = getBlockRange(hoveredBlock, editor.view);
    if (!range) return;

    try {
      const image = await uploadImage(file);
      const insertAt = pendingImageSide === 'above' ? range.from : range.to;
      editor
        .chain()
        .focus()
        .insertContentAt(insertAt, {
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
      setPendingImageSide(null);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
  }, [editor, hoveredBlock, onClose, pendingImageSide, uploadImage]);

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

  // 语雀块菜单：转换 | 删除 复制 剪切 | 缩进 复制链接 | 在下方添加
  const headingLevel = /^H([1-6])$/.exec(hoveredBlock?.tagName ?? '')?.[1];
  const brickEntries: BrickMenuEntry[] = [
    ...(canConvert
      ? ([
          { key: 'turnInto', icon: 'Change', label: '转换', desc: headingLevel ? `H${headingLevel}` : undefined, submenu: 'turnInto' },
          '|',
        ] as BrickMenuEntry[])
      : []),
    { key: 'delete', icon: 'NeDelete', label: '删除', onClick: () => void deleteBlock() },
    { key: 'copy', icon: 'NeCopy', label: '复制', onClick: () => void copyBlock() },
    { key: 'cut', icon: 'NeCut', label: '剪切', onClick: () => void copyBlock().then(() => deleteBlock()) },
    '|',
    { key: 'indent', icon: 'EditorIndent', label: '缩进', submenu: 'indent' },
    ...(headingAnchorId
      ? ([{ key: 'copyLink', icon: 'NeCTbCopyLink', label: '复制链接', onClick: () => void copyAnchorLink() }] as BrickMenuEntry[])
      : []),
    '|',
    { key: 'addBelow', icon: 'Add', label: '在下方添加', submenu: 'addBelow' },
  ];

  const handleTableClick: MenuProps['onClick'] = useCallback(({ key }: { key: string }) => {
    runTableCommand(key);
    onClose();
  }, [runTableCommand, onClose]);

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

  const renderInsertPanel = (side: 'above' | 'below', extra?: { onMouseEnter?: () => void; onMouseLeave?: () => void }) => (
    <BlockInsertPanel
      onMouseEnter={extra?.onMouseEnter}
      onMouseLeave={extra?.onMouseLeave}
      onInsertBlock={(type) => {
        insertBlock(side, type);
        onClose();
      }}
      onInsertTable={(rows, cols) => {
        insertTable(side, rows, cols);
        onClose();
      }}
      onInsertImage={() => {
        if (!uploadImage) {
          message.error('未选择工作空间');
          return;
        }
        setPendingImageSide(side);
        imageInputRef.current?.click();
      }}
      onClose={onClose}
    />
  );

  if (isTableTarget) {
    return (
      <div ref={menuRootRef} className="block-menu-popover block-menu-popover--table">
        <Menu
          items={tableItems}
          onClick={handleTableClick}
          selectable={false}
          style={{ border: 'none', borderRadius: 6 }}
        />
      </div>
    );
  }

  if (mode === 'insert') {
    return (
      <div ref={menuRootRef} className="block-menu-popover block-menu-popover--insert">
        {imageInput}
        {renderInsertPanel('below')}
      </div>
    );
  }

  let submenuContent: ReactNode = null;
  if (activeSubmenu === 'turnInto') {
    submenuContent = (
      <div className="brick-turn-into">
        <div className="brick-turn-into__icons">
          {CONVERT_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.label}
              aria-label={item.label}
              className={`brick-turn-into__icon${currentConvertTarget === item.key ? ' is-selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                convertBlock(item.key);
                onClose();
              }}
            >
              <YuqueIcon name={item.icon} />
            </button>
          ))}
        </div>
      </div>
    );
  } else if (activeSubmenu === 'indent') {
    submenuContent = (
      <div className="brick-menu brick-menu--sub">
        {([
          ['indent', 'EditorIndent', '增加缩进'],
          ['outdent', 'EditorOutdent', '减少缩进'],
        ] as const).map(([key, icon, label]) => (
          <div
            key={key}
            className="brick-menu__item"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              runIndent(key);
              onClose();
            }}
          >
            <YuqueIcon name={icon} className="brick-menu__icon" />
            <span className="brick-menu__text">{label}</span>
          </div>
        ))}
      </div>
    );
  } else if (activeSubmenu === 'addBelow') {
    submenuContent = renderInsertPanel('below');
  }

  return (
    <div ref={menuRootRef} className="block-menu-popover block-menu-popover--brick">
      {imageInput}
      <div className="brick-menu" onMouseLeave={scheduleCloseSubmenu}>
        {brickEntries.map((entry, index) => {
          if (entry === '|') return <div key={`divider-${index}`} className="brick-menu__divider" />;
          const isOpen = entry.submenu && activeSubmenu === entry.submenu;
          return (
            <div
              key={entry.key}
              className={`brick-menu__item${isOpen ? ' is-open' : ''}`}
              data-testid={`brick-menu-${entry.key}`}
              onMouseEnter={(event) => {
                if (entry.submenu) openSubmenu(entry.submenu, event.currentTarget);
                else scheduleCloseSubmenu();
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                if (entry.submenu) {
                  openSubmenu(entry.submenu, event.currentTarget);
                  return;
                }
                entry.onClick?.();
                onClose();
              }}
            >
              <YuqueIcon name={entry.icon} className="brick-menu__icon" />
              <span className="brick-menu__text">{entry.label}</span>
              {entry.desc && <span className="brick-menu__desc">{entry.desc}</span>}
              {entry.submenu && <YuqueIcon name="ArrowRight" className="brick-menu__arrow" />}
            </div>
          );
        })}
      </div>
      {submenuContent && (
        <div
          className="brick-submenu"
          style={{ top: submenuTop }}
          onMouseEnter={clearSubmenuHideTimer}
          onMouseLeave={scheduleCloseSubmenu}
        >
          {submenuContent}
        </div>
      )}
    </div>
  );
}
