"use client";

import { useCallback, useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import { RightOutlined, DownOutlined, MenuUnfoldOutlined, MenuFoldOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { resolveHeadingElementId } from "./markdown-editor/TableOfContents/headingId";
import { readPublicHeadingLabel, updatePublicHeadingHash } from "./public-heading-anchor";
import "./PublicDocTOC.css";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

const SCROLL_HEADER_OFFSET = 76;

export function PublicDocTOC() {
  const [headings, setHeadings] = useState<TOCItem[]>([]);
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });
  const itemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const elements = Array.from(
        document.querySelectorAll(".doc-content h1, .doc-content h2, .doc-content h3, .doc-content h4, .doc-content h5, .doc-content h6"),
      );
      const items = elements.map((el, index) => {
        const resolvedId = resolveHeadingElementId(el, `heading-${index}`);
        if (el.id !== resolvedId) {
          el.id = resolvedId;
        }
        return {
          id: resolvedId,
          text: readPublicHeadingLabel(el as HTMLElement),
          level: parseInt(el.tagName[1], 10),
        };
      });
      setHeadings(items);
      if (items.length > 0) {
        setActiveId(items[0].id);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (headings.length === 0) return;

    const updateActiveHeading = () => {
      let currentId = headings[0].id;
      for (const item of headings) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= SCROLL_HEADER_OFFSET) {
          currentId = item.id;
        }
      }
      setActiveId(currentId);
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [headings]);

  const updateIndicator = useCallback(() => {
    const container = itemsRef.current;
    if (!container || !activeId) return;
    const activeEl = container.querySelector<HTMLElement>(`.toc-item[data-id="${activeId}"]`);
    if (!activeEl) return;
    setIndicator({ top: activeEl.offsetTop, height: activeEl.offsetHeight });
  }, [activeId]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [activeId, headings, collapsedLevels, updateIndicator]);

  useEffect(() => {
    const container = itemsRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeId, headings, collapsedLevels, updateIndicator]);

  useEffect(() => {
    if (!activeId) return;
    const panel = document.querySelector(".public-toc-panel .toc-content");
    const activeEl = document.querySelector(".public-toc-panel .toc-item-active");
    if (!panel || !activeEl) return;

    const panelRect = panel.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    if (elRect.top < panelRect.top || elRect.bottom > panelRect.bottom) {
      activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeId]);

  const scrollToHeading = (id: string) => {
    setActiveId(id);
    const el = document.getElementById(id);
    if (el) {
      updatePublicHeadingHash(id);
      const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_HEADER_OFFSET;
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
          data-id={item.id}
          className={`toc-item level-${item.level}${activeId === item.id ? " toc-item-active" : ""}`}
          onClick={() => scrollToHeading(item.id)}
        >
          {isParent && (
            <span className="toc-toggle" onClick={(e) => toggleCollapse(item.id, e)}>
              {isCollapsed ? <RightOutlined /> : <DownOutlined />}
            </span>
          )}
          <span className="toc-item-text" title={item.text}>
            {item.text}
          </span>
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
        <div className="toc-items" ref={itemsRef}>
          <div className="toc-rail" aria-hidden>
            <div className="toc-rail-track" />
            {activeId && indicator.height > 0 && (
              <div
                className="toc-rail-indicator"
                style={{ top: indicator.top, height: indicator.height }}
              />
            )}
          </div>
          {renderItems()}
        </div>
      </div>
    </div>
  );
}
