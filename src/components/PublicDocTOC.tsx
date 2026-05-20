"use client";

import { useEffect, useState, useMemo } from "react";
import { RightOutlined, DownOutlined, MenuUnfoldOutlined, MenuFoldOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import "./PublicDocTOC.css";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

export function PublicDocTOC() {
  const [headings, setHeadings] = useState<TOCItem[]>([]);
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // wait for DOM to render content
    const timer = setTimeout(() => {
      const elements = Array.from(
        document.querySelectorAll(".doc-content h1, .doc-content h2, .doc-content h3, .doc-content h4, .doc-content h5, .doc-content h6")
      );
      const items = elements.map((el, index) => {
        if (!el.id) {
          el.id = `heading-${index}`;
        }
        return {
          id: el.id,
          text: el.textContent || "",
          level: parseInt(el.tagName[1], 10),
        };
      });
      setHeadings(items);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const headerHeight = 56;
      const top = el.getBoundingClientRect().top + window.scrollY - headerHeight - 20;
      window.scrollTo({ top, behavior: "smooth" });
    }
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

  if (headings.length === 0) return null;

  const renderItems = () => {
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
          onClick={() => scrollToHeading(item.id)}
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
    <div className="public-toc-panel">
      <div className="toc-header">
        <span className="toc-header-title">大纲</span>
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
