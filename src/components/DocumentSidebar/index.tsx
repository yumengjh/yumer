"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button, Dropdown, Input, Tooltip, message, Tag, Modal, type MenuProps } from "antd";
import {
  FileTextOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useDocument } from "../../contexts/DocumentContext";
import { DocumentInfoModal } from "../DocumentInfoModal";
import "./style.css";

const DEFAULT_WIDTH = 350;
const MIN_WIDTH = 250;
const MAX_WIDTH = 420;
const COLLAPSE_THRESHOLD = 120;
const SIDEBAR_LAYOUT_STORAGE_KEY = "app.docsidebar.layout.v1";

type PersistedSidebarLayout = {
  width: number;
  isCollapsed: boolean;
  lastExpandedWidth: number;
};

const clampExpandedWidth = (value: number): number => {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));
};

const readPersistedSidebarLayout = (): PersistedSidebarLayout => {
  const fallback: PersistedSidebarLayout = {
    width: DEFAULT_WIDTH,
    isCollapsed: false,
    lastExpandedWidth: DEFAULT_WIDTH,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedSidebarLayout>;
    const isCollapsed = Boolean(parsed.isCollapsed);
    const safeLastExpandedWidth = Number.isFinite(parsed.lastExpandedWidth)
      ? clampExpandedWidth(Number(parsed.lastExpandedWidth))
      : DEFAULT_WIDTH;
    const rawWidth = Number(parsed.width);
    const safeWidth = isCollapsed
      ? 0
      : Number.isFinite(rawWidth) && rawWidth > 0
        ? clampExpandedWidth(rawWidth)
        : safeLastExpandedWidth;
    return {
      width: safeWidth,
      isCollapsed,
      lastExpandedWidth: safeLastExpandedWidth,
    };
  } catch {
    return fallback;
  }
};

const writePersistedSidebarLayout = (layout: PersistedSidebarLayout) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore localStorage write failures
  }
};

interface DocumentSidebarProps {
  visible: boolean;
  onToggle: () => void;
  onSelect: (docId: string) => void | Promise<void>;
  onCreateNew?: () => void;
  currentDocId?: string;
  currentDocLoading?: boolean;
}

export default function DocumentSidebar({
  visible,
  onToggle,
  onSelect,
  onCreateNew,
  currentDocId,
  currentDocLoading = false,
}: DocumentSidebarProps) {
  const { documents, refreshDocs, createDoc, deleteDoc, updateDoc } = useDocument();
  const [creating, setCreating] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const initialLayout = useMemo(() => readPersistedSidebarLayout(), []);

  const [searchValue, setSearchValue] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.width);
  const [isResizing, setIsResizing] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const openingDocContentLoadingSeenRef = useRef(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const lastExpandedWidthRef = useRef(initialLayout.lastExpandedWidth);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [infoDoc, setInfoDoc] = useState<any>(null);

  const isCollapsed = !visible;

  useEffect(() => {
    if (visible) {
      refreshDocs().catch(() => {});
    }
  }, [visible, refreshDocs]);

  useEffect(() => {
    if (!openingDocId) {
      openingDocContentLoadingSeenRef.current = false;
      return;
    }

    if (currentDocId !== openingDocId) return;

    if (currentDocLoading) {
      openingDocContentLoadingSeenRef.current = true;
      return;
    }

    if (openingDocContentLoadingSeenRef.current) {
      openingDocContentLoadingSeenRef.current = false;
      setOpeningDocId(null);
    }
  }, [currentDocId, currentDocLoading, openingDocId]);

  // 提取所有分类和标签
  const { categories, tags } = useMemo(() => {
    const categorySet = new Set<string>();
    const tagSet = new Set<string>();

    documents.forEach((doc) => {
      if (doc.category) categorySet.add(doc.category);
      if (doc.tags) doc.tags.forEach((tag) => tagSet.add(tag));
    });

    return {
      categories: Array.from(categorySet).sort(),
      tags: Array.from(tagSet).sort(),
    };
  }, [documents]);

  useEffect(() => {
    const width = isCollapsed ? 0 : sidebarWidth + 14;
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  }, [isCollapsed, sidebarWidth]);

  useEffect(() => {
    if (isCollapsed || sidebarWidth <= 0) return;
    lastExpandedWidthRef.current = clampExpandedWidth(sidebarWidth);
  }, [isCollapsed, sidebarWidth]);

  useEffect(() => {
    writePersistedSidebarLayout({
      width: isCollapsed ? 0 : sidebarWidth,
      isCollapsed,
      lastExpandedWidth: lastExpandedWidthRef.current,
    });
  }, [isCollapsed, sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (event: MouseEvent) => {
      let nextWidth = event.clientX;
      if (nextWidth < COLLAPSE_THRESHOLD) {
        nextWidth = 0;
      }
      nextWidth = Math.max(0, Math.min(MAX_WIDTH, nextWidth));
      if (nextWidth === 0) {
        setSidebarWidth(0);
        if (visible) onToggle();
        return;
      }
      if (nextWidth < MIN_WIDTH) {
        nextWidth = MIN_WIDTH;
      }
      lastExpandedWidthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
      if (!visible) onToggle();
    };

    const onMouseUp = () => {
      setIsResizing(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing, visible, onToggle]);

  const startResizing = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isCollapsed) return;
    const target = event.target as HTMLElement;
    if (target.closest(".toggle-btn")) return;
    setIsResizing(true);
  };

  const toggleSidebar = () => {
    if (isCollapsed) {
      const restoreWidth = clampExpandedWidth(lastExpandedWidthRef.current || DEFAULT_WIDTH);
      setSidebarWidth(restoreWidth);
    } else {
      lastExpandedWidthRef.current = sidebarWidth > 0 ? sidebarWidth : DEFAULT_WIDTH;
      setSidebarWidth(0);
    }
    onToggle();
  };

  // 过滤文档
  const filteredDocs = useMemo(() => {
    let result = documents;

    // 按搜索文本过滤
    const keyword = searchValue.trim().toLowerCase();
    if (keyword) {
      result = result.filter((doc) => (doc.title || "").toLowerCase().includes(keyword));
    }

    // 按分类过滤
    if (selectedCategory) {
      result = result.filter((doc) => doc.category === selectedCategory);
    }

    // 按标签过滤
    if (selectedTag) {
      result = result.filter((doc) => doc.tags?.includes(selectedTag));
    }

    return result;
  }, [documents, searchValue, selectedCategory, selectedTag]);

  // 按主题分组文档，分离未分类和已分类
  const { uncategorizedDocs, categorizedGroups } = useMemo(() => {
    const groups: Record<string, typeof filteredDocs> = {};
    const uncategorized: typeof filteredDocs = [];

    filteredDocs.forEach((doc) => {
      if (doc.category) {
        if (!groups[doc.category]) {
          groups[doc.category] = [];
        }
        groups[doc.category].push(doc);
      } else {
        uncategorized.push(doc);
      }
    });

    const sortedGroups = Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, docs]) => ({ category, docs }));

    return {
      uncategorizedDocs: uncategorized,
      categorizedGroups: sortedGroups,
    };
  }, [filteredDocs]);

  const handleClearFilters = useCallback(() => {
    setSearchValue("");
    setSelectedCategory(null);
    setSelectedTag(null);
  }, []);

  const toggleCategoryCollapse = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const hasActiveFilters = searchValue || selectedCategory || selectedTag;

  const handleDocSelect = async (docId: string) => {
    if (currentDocId === docId || openingDocId === docId) return;
    setOpeningDocId(docId);
    openingDocContentLoadingSeenRef.current = false;
    try {
      await onSelect(docId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "打开文档失败";
      message.error(msg);
      setOpeningDocId(null);
      openingDocContentLoadingSeenRef.current = false;
    }
  };

  const handleCreateInCategory = async (category: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    try {
      await createDoc({
        title: "无标题文档",
        category: category,
      });
      message.success(`在分类「${category}」下已新建文档`);
    } catch {
      message.error("创建文档失败");
    }
  };

  const handleRenameDoc = (docId: string, currentTitle: string) => {
    let nextTitle = currentTitle;
    Modal.confirm({
      title: "重命名文档",
      content: (
        <Input
          defaultValue={currentTitle}
          placeholder="请输入新的文档标题"
          onChange={(e) => {
            nextTitle = e.target.value;
          }}
          onPressEnter={() => {
            const trimmed = nextTitle.trim();
            if (trimmed) {
              updateDoc(docId, { title: trimmed })
                .then(() => {
                  message.success("重命名成功");
                  Modal.destroyAll();
                })
                .catch(() => message.error("重命名失败"));
            }
          }}
        />
      ),
      okText: "保存",
      cancelText: "取消",
      onOk: async () => {
        const trimmed = nextTitle.trim();
        if (!trimmed) {
          message.warning("标题不能为空");
          return Promise.reject();
        }
        try {
          await updateDoc(docId, { title: trimmed });
          message.success("重命名成功");
        } catch {
          message.error("重命名失败");
          return Promise.reject();
        }
      },
    });
  };

  const handleDeleteDoc = (docId: string, docTitle: string) => {
    Modal.confirm({
      title: "确认删除文档",
      content: `您确定要删除文档「${docTitle || "未命名文档"}」吗？此操作无法撤销。`,
      okText: "确认",
      cancelText: "取消",
      okType: "danger",
      onOk: async () => {
        try {
          await deleteDoc(docId);
          message.success("删除文档成功");
        } catch {
          message.error("删除文档失败");
        }
      },
    });
  };

  const getDocNodeMenu = (doc: any): MenuProps["items"] => [
    {
      key: "rename",
      label: "重命名",
      onClick: () => handleRenameDoc(doc.docId, doc.title),
    },
    {
      key: "edit-info",
      label: "编辑元信息",
      onClick: () => {
        setInfoDoc(doc);
        setInfoModalOpen(true);
      },
    },
    {
      key: "copy-link",
      label: "复制链接",
      onClick: () => {
        const url = `${window.location.origin}/doc/${doc.docId}`;
        void navigator.clipboard.writeText(url);
        message.success("文档链接已复制");
      },
    },
    { type: "divider" },
    {
      key: "delete",
      label: "删除",
      danger: true,
      onClick: () => handleDeleteDoc(doc.docId, doc.title),
    },
  ];

  return (
    <div className="doc-sidebar-container">
      <div
        ref={sidebarRef}
        className={`doc-sidebar ${isCollapsed ? "doc-sidebar--collapsed" : ""} ${isResizing ? "doc-sidebar--resizing" : ""}`}
        style={{
          width: isCollapsed ? 0 : sidebarWidth,
          opacity: isCollapsed ? 0 : 1,
          pointerEvents: isCollapsed ? "none" : "auto",
        }}
      >
        <div className="doc-sidebar__inner">
          {/* 搜索和新建 */}
          <div className="doc-sidebar__top">
            <div className="doc-sidebar__search-row">
              <div className="doc-sidebar__search-wrapper">
                <SearchOutlined className="doc-sidebar__search-icon" />
                <Input
                  placeholder="搜索"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="doc-sidebar__search-input"
                  bordered={false}
                  suffix={<span className="doc-sidebar__search-shortcut">Ctrl + J</span>}
                />
              </div>
              <Button
                type="text"
                size="small"
                icon={creating ? <LoadingOutlined /> : <PlusOutlined />}
                className="doc-sidebar__add-btn"
                disabled={creating}
                onClick={async () => {
                  if (onCreateNew) { onCreateNew(); return; }
                  setCreating(true);
                  try {
                    await createDoc({ title: "无标题文档" });
                    message.success("已新建文档");
                  } catch {
                    message.error("创建文档失败");
                  } finally {
                    setCreating(false);
                  }
                }}
              />
            </div>
          </div>

          {/* 分割线 */}
          <div className="doc-sidebar__divider" />

          {/* 文档列表 */}
          <div className="doc-sidebar__scroll">
            <div className="doc-sidebar__documents-section">
              <div className="doc-sidebar__documents-list">
                {uncategorizedDocs.length === 0 && categorizedGroups.length === 0 ? (
                  <div className="doc-sidebar__document-item">
                    <span className="doc-sidebar__document-title">
                      {searchValue ? "没有匹配的文档" : "暂无文档"}
                    </span>
                  </div>
                ) : (
                  <>
                    {/* 未分类文档 */}
                    {uncategorizedDocs.map((doc) => (
                      <div
                        key={doc.docId}
                        className={`doc-sidebar__document-item ${currentDocId === doc.docId ? "doc-sidebar__document-item--active" : ""} ${openingDocId === doc.docId ? "doc-sidebar__document-item--loading" : ""}`}
                        onClick={() => void handleDocSelect(doc.docId)}
                      >
                        {openingDocId === doc.docId ? (
                          <LoadingOutlined className="doc-sidebar__document-icon" />
                        ) : (
                          <FileTextOutlined className="doc-sidebar__document-icon" />
                        )}
                        <div className="doc-sidebar__document-info">
                          <span className="doc-sidebar__document-title">{doc.title || "未命名文档"}</span>
                          {doc.tags && doc.tags.length > 0 && (
                            <div className="doc-sidebar__document-tags">
                              {doc.tags.slice(0, 2).map((tag) => (
                                <Tag key={tag} className="doc-sidebar__tag">
                                  {tag}
                                </Tag>
                              ))}
                              {doc.tags.length > 2 && (
                                <Tag className="doc-sidebar__tag">+{doc.tags.length - 2}</Tag>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="doc-sidebar__document-actions" onClick={(e) => e.stopPropagation()}>
                          <Dropdown menu={{ items: getDocNodeMenu(doc) }} trigger={["click"]}>
                            <Button
                              type="text"
                              size="small"
                              icon={<MoreOutlined />}
                              className="doc-sidebar__document-action"
                            />
                          </Dropdown>
                        </div>
                      </div>
                    ))}

                    {/* 已分类主题组 */}
                    {categorizedGroups.map(({ category, docs }) => {
                      const isCategoryCollapsed = collapsedCategories.has(category);
                      return (
                        <div key={category} className="doc-sidebar__category-group">
                          <div
                            className="doc-sidebar__category-header"
                            onClick={() => toggleCategoryCollapse(category)}
                          >
                            <RightOutlined className={`doc-sidebar__category-arrow ${!isCategoryCollapsed ? "doc-sidebar__category-arrow--expanded" : ""}`} />
                            <span className="doc-sidebar__category-name">{category}</span>
                            
                            <div className="doc-sidebar__category-actions" onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="text"
                                size="small"
                                icon={<PlusOutlined />}
                                className="doc-sidebar__category-action"
                                onClick={(e) => void handleCreateInCategory(category, e)}
                              />
                            </div>
                            <span className="doc-sidebar__category-count">{docs.length}</span>
                          </div>
                          {!isCategoryCollapsed && (
                            <div className="doc-sidebar__category-docs">
                              {docs.map((doc) => (
                                <div
                                  key={doc.docId}
                                  className={`doc-sidebar__document-item ${currentDocId === doc.docId ? "doc-sidebar__document-item--active" : ""} ${openingDocId === doc.docId ? "doc-sidebar__document-item--loading" : ""}`}
                                  onClick={() => void handleDocSelect(doc.docId)}
                                >
                                  {openingDocId === doc.docId ? (
                                    <LoadingOutlined className="doc-sidebar__document-icon" />
                                  ) : (
                                    <FileTextOutlined className="doc-sidebar__document-icon" />
                                  )}
                                  <div className="doc-sidebar__document-info">
                                    <span className="doc-sidebar__document-title">{doc.title || "未命名文档"}</span>
                                    {doc.tags && doc.tags.length > 0 && (
                                      <div className="doc-sidebar__document-tags">
                                        {doc.tags.slice(0, 2).map((tag) => (
                                          <Tag key={tag} className="doc-sidebar__tag">
                                            {tag}
                                          </Tag>
                                        ))}
                                        {doc.tags.length > 2 && (
                                          <Tag className="doc-sidebar__tag">+{doc.tags.length - 2}</Tag>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="doc-sidebar__document-actions" onClick={(e) => e.stopPropagation()}>
                                    <Dropdown menu={{ items: getDocNodeMenu(doc) }} trigger={["click"]}>
                                      <Button
                                        type="text"
                                        size="small"
                                        icon={<MoreOutlined />}
                                        className="doc-sidebar__document-action"
                                      />
                                    </Dropdown>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
          {infoModalOpen && infoDoc && (
            <DocumentInfoModal
              open={infoModalOpen}
              onClose={() => {
                setInfoModalOpen(false);
                setInfoDoc(null);
              }}
              doc={infoDoc}
            />
          )}
        </div>
      </div>

      <div className={`doc-sidebar__resizer ${isCollapsed ? "doc-sidebar__resizer--collapsed" : ""}`} onMouseDown={startResizing}>
        <div className="doc-sidebar__split" />
        <Tooltip title={isCollapsed ? "展开侧边栏" : "折叠侧边栏"} placement="right">
          <button
            type="button"
            className="doc-sidebar__toggle-btn"
            onClick={toggleSidebar}
            aria-expanded={!isCollapsed}
          >
            <svg
              className={`doc-sidebar__toggle-icon ${isCollapsed ? "doc-sidebar__toggle-icon--collapsed" : ""}`}
              viewBox="0 0 1024 1024"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M753.613 996.727l-484.233-485.222 485.222-484.233z" fill="currentColor" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
