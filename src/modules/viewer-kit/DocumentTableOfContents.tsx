"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DownOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { resolveHeadingElementId } from "@/modules/editor-kit/shared";
import {
  DEFAULT_HEADING_SCROLL_OFFSET,
  findDocumentHeadings,
  readHeadingLabel,
  updateHeadingHash,
} from "./heading-anchor";
import "./styles/table-of-contents.css";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface DocumentTableOfContentsProps {
  contentSelector?: string;
  scrollOffset?: number;
  title?: string;
  expandAllLabel?: string;
  collapseAllLabel?: string;
}

export function DocumentTableOfContents({
  contentSelector,
  scrollOffset = DEFAULT_HEADING_SCROLL_OFFSET,
  title = "Outline",
  expandAllLabel = "Expand all",
  collapseAllLabel = "Collapse all",
}: DocumentTableOfContentsProps) {
  const [headings, setHeadings] = useState<TocItem[]>([]);
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });
  const itemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const items = findDocumentHeadings(document, { contentSelector }).map((el, index) => {
        const resolvedId = resolveHeadingElementId(el, `heading-${index}`);
        if (el.id !== resolvedId) {
          el.id = resolvedId;
        }

        return {
          id: resolvedId,
          text: readHeadingLabel(el),
          level: parseInt(el.tagName[1], 10),
        };
      });

      setHeadings(items);
      if (items.length > 0) {
        setActiveId(items[0].id);
      }
    }, 100);

    return () => window.clearTimeout(timer);
  }, [contentSelector]);

  useEffect(() => {
    if (headings.length === 0) return;

    const updateActiveHeading = () => {
      let currentId = headings[0].id;
      for (const item of headings) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= scrollOffset) {
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
  }, [headings, scrollOffset]);

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
  }, [activeId, collapsedLevels, headings, updateIndicator]);

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
    if (!el) return;

    updateHeadingHash(id);
    const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const toggleCollapse = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCollapsedLevels((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const allParentIds = useMemo(
    () =>
      headings
        .filter((item, index) => index < headings.length - 1 && headings[index + 1].level > item.level)
        .map((item) => item.id),
    [headings],
  );

  const toggleAll = () => {
    const isAnyExpanded = allParentIds.some((id) => !collapsedLevels[id]);

    if (isAnyExpanded) {
      const nextCollapsed: Record<string, boolean> = {};
      allParentIds.forEach((id) => {
        nextCollapsed[id] = true;
      });
      setCollapsedLevels(nextCollapsed);
      return;
    }

    setCollapsedLevels({});
  };

  const isAllCollapsed = useMemo(() => {
    if (allParentIds.length === 0) return false;
    return allParentIds.every((id) => collapsedLevels[id]);
  }, [allParentIds, collapsedLevels]);

  if (headings.length === 0) return null;

  const renderItems = () => {
    const items: React.ReactNode[] = [];

    headings.forEach((item, index) => {
      const isParent = index < headings.length - 1 && headings[index + 1].level > item.level;
      const isCollapsed = collapsedLevels[item.id];

      let shouldHide = false;
      for (let i = 0; i < index; i += 1) {
        const previous = headings[i];
        if (previous.level < item.level && collapsedLevels[previous.id]) {
          let isTrueAncestor = true;
          for (let j = i + 1; j < index; j += 1) {
            if (headings[j].level <= previous.level) {
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
          {isParent ? (
            <span className="toc-toggle" onClick={(event) => toggleCollapse(item.id, event)}>
              {isCollapsed ? <RightOutlined /> : <DownOutlined />}
            </span>
          ) : null}
          <span className="toc-item-text" title={item.text}>
            {item.text}
          </span>
        </div>,
      );
    });

    return items;
  };

  return (
    <div className="public-toc-panel">
      <div className="toc-header">
        <span className="toc-header-title">{title}</span>
        <Tooltip title={isAllCollapsed ? expandAllLabel : collapseAllLabel}>
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
            {activeId && indicator.height > 0 ? (
              <div
                className="toc-rail-indicator"
                style={{ top: indicator.top, height: indicator.height }}
              />
            ) : null}
          </div>
          {renderItems()}
        </div>
      </div>
    </div>
  );
}
