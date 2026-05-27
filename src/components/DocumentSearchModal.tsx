"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Modal, Input, Empty, Pagination, Spin, Tag, message } from "antd";
import { FileTextOutlined, SearchOutlined, DoubleLeftOutlined, DoubleRightOutlined } from "@ant-design/icons";
import { useDocument } from "../contexts/DocumentContext";
import { searchDocuments, type SearchItem } from "@/services/search";
import "./DocumentSearchModal.css";

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 400;

interface DocumentSearchModalProps {
  open: boolean;
  onClose: () => void;
}

function resultTitle(item: SearchItem): string {
  return item.type === "document" ? item.title : item.docTitle;
}

function resultDescription(item: SearchItem): string {
  return item.type === "document" ? "文档标题命中" : item.content;
}

export function DocumentSearchModal({ open, onClose }: DocumentSearchModalProps) {
  const { workspaceId, currentDoc, selectDoc, selectDocAndScroll } = useDocument();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeWorkspaceId = currentDoc?.workspaceId ?? workspaceId ?? undefined;
  const hasSearched = keyword.trim().length > 0;

  const resetState = useCallback(() => {
    setKeyword("");
    setPage(1);
    setItems([]);
    setTotal(0);
    setLoading(false);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const runSearch = useCallback(
    async (nextKeyword: string, nextPage: number) => {
      const trimmed = nextKeyword.trim();
      if (!trimmed) {
        setItems([]);
        setTotal(0);
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const result = await searchDocuments({
          query: trimmed,
          workspaceId: activeWorkspaceId,
          page: nextPage,
          pageSize: PAGE_SIZE,
          type: "all",
        });
        if (controller.signal.aborted) return;
        setItems(result.items);
        setTotal(result.total);
        setActiveIndex(-1);
      } catch (error) {
        if (controller.signal.aborted) return;
        setItems([]);
        setTotal(0);
        message.error(error instanceof Error ? error.message : "搜索失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [activeWorkspaceId],
  );

  const debouncedSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = value.trim();
      if (!trimmed) {
        setItems([]);
        setTotal(0);
        setPage(1);
        setActiveIndex(-1);
        return;
      }
      debounceRef.current = setTimeout(() => {
        setPage(1);
        void runSearch(trimmed, 1);
      }, DEBOUNCE_MS);
    },
    [runSearch],
  );

  const handleKeywordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setKeyword(value);
      debouncedSearch(value);
    },
    [debouncedSearch],
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(nextPage);
      setActiveIndex(-1);
      void runSearch(keyword, nextPage);
    },
    [runSearch, keyword],
  );

  const handleOpenResult = useCallback(
    async (item: SearchItem) => {
      try {
        if (item.type === "block") {
          await selectDocAndScroll(item.docId, item.blockId);
        } else {
          await selectDoc(item.docId);
        }
        onClose();
      } catch {
        message.error("打开搜索结果失败");
      }
    },
    [onClose, selectDoc, selectDocAndScroll],
  );

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev < items.length - 1 ? prev + 1 : 0;
          // 滚动到可见区域
          const el = listRef.current?.querySelector(`[data-index="${next}"]`);
          el?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev > 0 ? prev - 1 : items.length - 1;
          const el = listRef.current?.querySelector(`[data-index="${next}"]`);
          el?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < items.length) {
        e.preventDefault();
        void handleOpenResult(items[activeIndex]);
      }
    },
    [items, activeIndex, handleOpenResult],
  );

  const emptyDescription = useMemo(() => {
    if (!hasSearched) return "输入关键词开始搜索当前工作空间文档";
    return "没有找到匹配结果";
  }, [hasSearched]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      title="搜索文档"
      destroyOnHidden
      className="document-search-modal"
      zIndex={1100}
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) resetState();
      }}
    >
      <div className="document-search" onKeyDown={handleKeyDown}>
        <Input
          allowClear
          autoFocus
          placeholder="搜索文档标题和内容…"
          prefix={<SearchOutlined />}
          size="large"
          value={keyword}
          onChange={handleKeywordChange}
        />

        <div className="document-search__meta">
          {hasSearched && !loading && items.length > 0 ? (
            <span>
              关键词 "{keyword.trim()}" 共 {total} 条结果
            </span>
          ) : null}
        </div>

        <div className="document-search__results" ref={listRef}>
          {loading ? (
            <div className="document-search__loading">
              <Spin size="large" />
            </div>
          ) : items.length === 0 && hasSearched ? (
            <Empty description="没有找到匹配结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : items.length === 0 ? null : (
            items.map((item, index) => (
              <button
                key={item.type === "document" ? item.docId : item.blockId}
                type="button"
                className={`document-search__item${index === activeIndex ? " document-search__item--active" : ""}`}
                data-index={index}
                onClick={() => void handleOpenResult(item)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <div className="document-search__item-icon">
                  {item.type === "document" && "icon" in item && item.icon ? (
                    <span>{item.icon}</span>
                  ) : (
                    <FileTextOutlined />
                  )}
                </div>

                <div className="document-search__item-body">
                  <div className="document-search__item-head">
                    <span className="document-search__item-title">{resultTitle(item)}</span>
                    <Tag bordered={false} color={item.type === "document" ? "blue" : "gold"}>
                      {item.type === "document" ? "文档" : "内容"}
                    </Tag>
                  </div>
                  <div className="document-search__item-desc">{resultDescription(item)}</div>
                </div>
              </button>
            ))
          )}
        </div>

        {total > PAGE_SIZE ? (
          <div className="document-search__pagination">
            <Pagination
              current={page}
              onChange={handlePageChange}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              total={total}
              size="small"
              itemRender={(_page, type, originalElement) => {
                if (type === "jump-prev") {
                  return <DoubleLeftOutlined style={{ fontSize: 10 }} />;
                }
                if (type === "jump-next") {
                  return <DoubleRightOutlined style={{ fontSize: 10 }} />;
                }
                return originalElement;
              }}
            />
          </div>
        ) : null}

        <div className="document-search__footer">
          <span className="document-search__hints">⌘K 搜索 · ↑↓ 导航 · Enter 打开</span>
          <span>Powered by <strong>YUITER</strong></span>
        </div>
      </div>
    </Modal>
  );
}
