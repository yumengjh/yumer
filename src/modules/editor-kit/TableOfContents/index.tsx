import { useEffect, useState, useCallback, useMemo } from "react";
import { 
  RightOutlined, 
  DownOutlined, 
  MenuUnfoldOutlined,
  MenuFoldOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { Editor } from "@tiptap/react";
import { useMarkdownEditor } from "../EditorContext";
import { resolveHeadingId } from "./headingId";
import "./style.css";

interface TOCItem {
  id: string;
  text: string;
  level: number;
  pos: number;
}

interface TableOfContentsProps {
  onClose: () => void;
}

export default function TableOfContents({ onClose }: TableOfContentsProps) {
  const editor = useMarkdownEditor() as Editor | null;
  const [headings, setHeadings] = useState<TOCItem[]>([]);
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});

  const updateHeadings = useCallback(() => {
    if (!editor) return;

    const items: TOCItem[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        items.push({
          id: resolveHeadingId({
            anchorId: typeof node.attrs.anchorId === "string" ? node.attrs.anchorId : null,
            fallbackId: `heading-${pos}`,
          }),
          text: node.textContent,
          level: node.attrs.level,
          pos,
        });
      }
    });
    setHeadings(items);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    updateHeadings();

    const handleUpdate = () => updateHeadings();
    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, updateHeadings]);

  const scrollToHeading = (pos: number) => {
    if (!editor) return;
    editor.commands.focus();
    editor.commands.setTextSelection(pos);
    editor.view.dispatch(editor.state.tr.scrollIntoView());
    
    setTimeout(() => {
      const headerHeight = 48 + 48; // DocumentHeader + Toolbar
      window.scrollBy(0, -headerHeight - 20);
    }, 10);
  };

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedLevels((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleAll = () => {
    const allParentIds = headings.filter((item, index) => 
      index < headings.length - 1 && headings[index + 1].level > item.level
    ).map(item => item.id);

    const isAnyExpanded = allParentIds.some(id => !collapsedLevels[id]);
    
    if (isAnyExpanded) {
      const newCollapsed: Record<string, boolean> = {};
      allParentIds.forEach(id => newCollapsed[id] = true);
      setCollapsedLevels(newCollapsed);
    } else {
      setCollapsedLevels({});
    }
  };

  const isAllCollapsed = useMemo(() => {
    const allParentIds = headings.filter((item, index) => 
      index < headings.length - 1 && headings[index + 1].level > item.level
    ).map(item => item.id);
    if (allParentIds.length === 0) return false;
    return allParentIds.every(id => collapsedLevels[id]);
  }, [headings, collapsedLevels]);

  const renderItems = () => {
    if (headings.length === 0) {
      return <div className="toc-empty">暂无标题</div>;
    }

    const items: React.ReactNode[] = [];
    headings.forEach((item, index) => {
      const isParent = index < headings.length - 1 && headings[index + 1].level > item.level;
      const isCollapsed = collapsedLevels[item.id];
      
      let shouldHide = false;
      for (let i = 0; i < index; i++) {
        const prev = headings[i];
        if (prev.level < item.level && collapsedLevels[prev.id]) {
          let isTrueAncestor = true;
          for (let j = i + 1; j < index; j++) {
            if (headings[j].level <= prev.level) {
              isTrueAncestor = false;
              break;
            }
          }
          if (isTrueAncestor) {
            shouldHide = true;
            break;
          }
        }
      }

      if (shouldHide) return;

      items.push(
        <div 
          key={item.id} 
          className={`toc-item level-${item.level}`}
          onClick={() => scrollToHeading(item.pos)}
        >
          <span className="toc-item-indent" style={{ width: (item.level - 1) * 12 }} />
          <span className="toc-item-icon">
            {isParent && (
              <span className="toc-toggle" onClick={(e) => toggleCollapse(item.id, e)}>
                {isCollapsed ? <RightOutlined /> : <DownOutlined />}
              </span>
            )}
          </span>
          <span className="toc-item-text" title={item.text}>{item.text}</span>
        </div>
      );
    });

    return items;
  };

  return (
    <div className="toc-panel radical">
      <div className="toc-header">
        <span className="toc-header-title">目录</span>
        <Tooltip title={isAllCollapsed ? "全部展开" : "全部收起"}>
          <Button 
            type="text" 
            size="small" 
            icon={isAllCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} 
            onClick={toggleAll}
            className="toc-global-toggle"
          />
        </Tooltip>
      </div>
      <div className="toc-content">
        {renderItems()}
      </div>
    </div>
  );
}
