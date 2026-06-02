"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Modal, Select, Button, Spin, Tag, Empty, message } from "antd";
import { SwapOutlined, CloseCircleOutlined } from "@ant-design/icons";
import htmldiff from "htmldiff-js";
import {
  getRevisions,
  getVersionContent,
  getVersionDiff,
  getEditContent,
  revertDocument,
  type Revision,
  type DiffSummary,
  type DiffRef,
  type RevertDraftStrategy,
} from "../services/document";
import { versionTreeToHtml, annotateBlockChanges } from "../services/version-html";
import DeferredCodeBlockRenderer from "./DeferredCodeBlockRenderer";
import "@/components/markdown-editor/styles/editor.css";
import "./VersionDiffModal.css";

interface VersionDiffModalProps {
  open: boolean;
  onClose: () => void;
  docId: string;
  onReverted?: () => void | Promise<void>;
}

type RefKey = "draft" | `revision:${number}`;

type DraftMeta = {
  exists: boolean;
  updatedAt?: string | null;
  baseDocVer?: number | null;
};

function refToKey(ref: DiffRef): RefKey {
  return ref.kind === "draft" ? "draft" : (`revision:${ref.version ?? 0}` as RefKey);
}

function keyToRef(key: RefKey): DiffRef {
  if (key === "draft") return { kind: "draft" };
  return { kind: "revision", version: Number(key.split(":")[1]) };
}

export function VersionDiffModal({ open, onClose, docId, onReverted }: VersionDiffModalProps) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [draftMeta, setDraftMeta] = useState<DraftMeta>({ exists: false });

  const [selectedKey, setSelectedKey] = useState<RefKey | null>(null);
  const [singleHtml, setSingleHtml] = useState("");
  const [loadingSingle, setLoadingSingle] = useState(false);

  const [fromKey, setFromKey] = useState<RefKey | null>(null);
  const [toKey, setToKey] = useState<RefKey | null>(null);
  const [diffHtml, setDiffHtml] = useState("");
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [noVisibleDiff, setNoVisibleDiff] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [revertTargetVersion, setRevertTargetVersion] = useState<number | null>(null);
  const [reverting, setReverting] = useState(false);

  const contentCacheRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const loadContent = useCallback(
    async (key: RefKey) => {
      const cacheKey = key;
      const cached = contentCacheRef.current.get(cacheKey);
      if (cached) {
        setSingleHtml(cached);
        setContentLoaded(true);
        return cached;
      }

      setLoadingSingle(true);
      try {
        let html = "";
        if (key === "draft") {
          const resp = await getEditContent(docId);
          html = resp.tree ? versionTreeToHtml(resp.tree) : "";
        } else {
          const version = keyToRef(key).version;
          const resp = await getVersionContent(docId, version as number);
          html = resp.tree ? versionTreeToHtml(resp.tree) : "";
        }
        contentCacheRef.current.set(cacheKey, html);
        setSingleHtml(html);
        setContentLoaded(true);
        return html;
      } catch {
        setSingleHtml("");
        setContentLoaded(true);
        return "";
      } finally {
        setLoadingSingle(false);
      }
    },
    [docId],
  );

  useEffect(() => {
    if (!open || !docId) return;
    let cancelled = false;

    const resetState = () => {
      contentCacheRef.current.clear();
      setSelectedKey(null);
      setSingleHtml("");
      setContentLoaded(false);
      setFromKey(null);
      setToKey(null);
      setDiffHtml("");
      setDiffSummary(null);
      setNoVisibleDiff(false);
      setRevertTargetVersion(null);
      setDraftMeta({ exists: false });
    };

    resetState();
    setLoadingRevisions(true);

    Promise.all([getRevisions(docId, 1, 100), getEditContent(docId)])
      .then(([revisionResp, editResp]) => {
        if (cancelled) return;
        const sorted = [...revisionResp.items].sort((a, b) => b.docVer - a.docVer);
        const hasDraft = Boolean(editResp.draft?.exists);
        const nextDraftMeta: DraftMeta = {
          exists: hasDraft,
          updatedAt: editResp.draft?.updatedAt ?? null,
          baseDocVer: editResp.draft?.baseDocVer ?? null,
        };
        setRevisions(sorted);
        setDraftMeta(nextDraftMeta);

        const latestRevisionKey = sorted.length > 0 ? (`revision:${sorted[0].docVer}` as RefKey) : null;
        setSelectedKey(hasDraft ? "draft" : latestRevisionKey);

        if (hasDraft && latestRevisionKey) {
          setFromKey(latestRevisionKey);
          setToKey("draft");
        } else if (sorted.length >= 2) {
          setFromKey(`revision:${sorted[1].docVer}` as RefKey);
          setToKey(`revision:${sorted[0].docVer}` as RefKey);
        } else if (latestRevisionKey) {
          setFromKey(latestRevisionKey);
          setToKey(latestRevisionKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRevisions([]);
          setDraftMeta({ exists: false });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRevisions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, docId]);

  const handleSelectItem = useCallback(
    (key: RefKey) => {
      setSelectedKey(key);
      setContentLoaded(false);
      setDiffHtml("");
      setDiffSummary(null);
      setNoVisibleDiff(false);
      void loadContent(key);
    },
    [loadContent],
  );

  const handleCancelDiff = useCallback(() => {
    setDiffHtml("");
    setDiffSummary(null);
    setNoVisibleDiff(false);
    if (selectedKey) {
      const cached = contentCacheRef.current.get(selectedKey);
      if (cached !== undefined) setSingleHtml(cached);
    }
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey || contentLoaded || loadingSingle) return;
    const timer = window.setTimeout(() => {
      void loadContent(selectedKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedKey, contentLoaded, loadingSingle, loadContent]);

  const handleCompare = useCallback(async () => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const fromRef = keyToRef(fromKey);
    const toRef = keyToRef(toKey);
    if (
      fromRef.kind === "revision" &&
      toRef.kind === "revision" &&
      typeof fromRef.version === "number" &&
      typeof toRef.version === "number" &&
      fromRef.version > toRef.version
    ) {
      message.warning("起始版本不能大于目标版本，请检查选择顺序");
      return;
    }

    setLoadingDiff(true);
    setDiffHtml("");
    setDiffSummary(null);
    setNoVisibleDiff(false);
    try {
      const diffResp = await getVersionDiff(docId, fromRef, toRef);
      const hasVisibleChanges =
        diffResp.summary.added > 0 ||
        diffResp.summary.deleted > 0 ||
        diffResp.summary.modified > 0 ||
        diffResp.summary.moved > 0 ||
        diffResp.summary.reordered > 0 ||
        diffResp.summary.indentChanged > 0;

      const fromCacheKey = refToKey(diffResp.fromRef);
      const toCacheKey = refToKey(diffResp.toRef);

      let fromHtml = contentCacheRef.current.get(fromCacheKey);
      if (!fromHtml && diffResp.fromContent?.tree) {
        fromHtml = versionTreeToHtml(diffResp.fromContent.tree);
        contentCacheRef.current.set(fromCacheKey, fromHtml);
      }

      let toHtml = contentCacheRef.current.get(toCacheKey);
      if (!toHtml && diffResp.toContent?.tree) {
        toHtml = versionTreeToHtml(diffResp.toContent.tree);
        contentCacheRef.current.set(toCacheKey, toHtml);
      }

      if (!hasVisibleChanges) {
        setNoVisibleDiff(true);
      } else if (fromHtml && toHtml) {
        const merged = htmldiff.execute(fromHtml, toHtml);
        setDiffHtml(annotateBlockChanges(merged, diffResp.changes));
      }

      setDiffSummary(diffResp.summary);
    } catch {
      setDiffHtml("<p>对比失败，请重试</p>");
    } finally {
      setLoadingDiff(false);
    }
  }, [docId, fromKey, toKey]);

  const getRefLabel = useCallback(
    (key: RefKey | null) => {
      if (!key) return "";
      if (key === "draft") return "草稿";
      const version = keyToRef(key).version as number;
      return `v${version}`;
    },
    [],
  );

  const getRefTime = useCallback(
    (key: RefKey | null) => {
      if (!key) return "";
      if (key === "draft") {
        return draftMeta.updatedAt ? formatTime(draftMeta.updatedAt) : "";
      }
      const version = keyToRef(key).version as number;
      return revisions.find((r) => r.docVer === version)?.createdAt
        ? formatTime(revisions.find((r) => r.docVer === version)!.createdAt)
        : "";
    },
    [draftMeta.updatedAt, revisions],
  );

  const getRefMessage = useCallback(
    (key: RefKey | null) => {
      if (!key) return "";
      if (key === "draft") {
        return draftMeta.baseDocVer ? `基于 v${draftMeta.baseDocVer}` : "未保存草稿";
      }
      const version = keyToRef(key).version as number;
      return revisions.find((r) => r.docVer === version)?.message ?? "";
    },
    [draftMeta.baseDocVer, revisions],
  );

  const versionOptions = useMemo(() => {
    const options: Array<{ value: RefKey; label: string }> = [];
    if (draftMeta.exists) {
      options.push({
        value: "draft",
        label: draftMeta.updatedAt ? `草稿 — ${formatTime(draftMeta.updatedAt)}` : "草稿",
      });
    }
    options.push(
      ...revisions.map((r) => ({
        value: `revision:${r.docVer}` as RefKey,
        label: `v${r.docVer} — ${formatTime(r.createdAt)}`,
      })),
    );
    return options;
  }, [draftMeta.exists, draftMeta.updatedAt, revisions]);

  const renderedHtml = diffHtml || singleHtml;
  const renderedHtmlKey = diffHtml
    ? `diff-${fromKey ?? "none"}-${toKey ?? "none"}`
    : `single-${selectedKey ?? "none"}`;
  const selectedRevisionVersion =
    selectedKey && selectedKey !== "draft" ? (keyToRef(selectedKey).version as number) : null;
  const canRevertSelectedVersion =
    selectedRevisionVersion !== null && selectedRevisionVersion !== revisions[0]?.docVer;

  const executeRevert = useCallback(
    async (draftStrategy?: RevertDraftStrategy) => {
      if (selectedRevisionVersion === null) return;

      setReverting(true);
      try {
        await revertDocument(docId, selectedRevisionVersion, draftStrategy);
        if (draftStrategy === "preserve") {
          message.success(`已保存草稿并回退到 v${selectedRevisionVersion}`);
        } else if (draftStrategy === "discard") {
          message.success(`已丢弃草稿并回退到 v${selectedRevisionVersion}`);
        } else {
          message.success(`已回退到 v${selectedRevisionVersion}`);
        }
        setRevertTargetVersion(null);
        await onReverted?.();
        onClose();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "回退失败，请重试");
      } finally {
        setReverting(false);
      }
    },
    [docId, onClose, onReverted, selectedRevisionVersion],
  );

  const openRevertDialog = useCallback(() => {
    if (!canRevertSelectedVersion || selectedRevisionVersion === null) return;
    setRevertTargetVersion(selectedRevisionVersion);
  }, [canRevertSelectedVersion, selectedRevisionVersion]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title="版本对比"
      width="100vw"
      styles={{ body: { padding: 0 } }}
      className="version-diff-modal"
      destroyOnHidden
      zIndex={1100}
    >
      <div className="version-diff">
        <aside className="version-diff__sidebar">
          <div className="version-diff__sidebar-header">
            版本历史 {revisions.length > 0 ? `(${revisions.length})` : ""}
          </div>
          <div className="version-diff__sidebar-list">
            {loadingRevisions ? (
              <div className="version-diff__loading">
                <Spin />
              </div>
            ) : versionOptions.length === 0 ? (
              <div className="version-diff__empty">暂无版本</div>
            ) : (
              <>
                {draftMeta.exists && (
                  <div
                    className={`version-diff__sidebar-item ${
                      selectedKey === "draft" ? "version-diff__sidebar-item--active" : ""
                    }`}
                    onClick={() => handleSelectItem("draft")}
                  >
                    <span className="version-diff__sidebar-ver">草稿</span>
                    <div className="version-diff__sidebar-info">
                      <div className="version-diff__sidebar-time">{getRefTime("draft")}</div>
                      <div className="version-diff__sidebar-msg">{getRefMessage("draft")}</div>
                    </div>
                  </div>
                )}
                {revisions.map((rev) => {
                  const key = `revision:${rev.docVer}` as RefKey;
                  return (
                    <div
                      key={rev.docVer}
                      className={`version-diff__sidebar-item ${
                        selectedKey === key ? "version-diff__sidebar-item--active" : ""
                      }`}
                      onClick={() => handleSelectItem(key)}
                    >
                      <span className="version-diff__sidebar-ver">v{rev.docVer}</span>
                      <div className="version-diff__sidebar-info">
                        <div className="version-diff__sidebar-time">{formatTime(rev.createdAt)}</div>
                        {rev.message && <div className="version-diff__sidebar-msg">{rev.message}</div>}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </aside>

        <main className="version-diff__main">
          <div className="version-diff__toolbar">
            <span className="version-diff__toolbar-label">从</span>
            <Select
              size="small"
              placeholder="选择版本或草稿"
              value={fromKey}
              onChange={setFromKey}
              options={versionOptions}
              style={{ minWidth: 180 }}
              showSearch
              optionFilterProp="label"
            />
            <SwapOutlined className="version-diff__toolbar-arrow" />
            <span className="version-diff__toolbar-label">到</span>
            <Select
              size="small"
              placeholder="选择版本或草稿"
              value={toKey}
              onChange={setToKey}
              options={versionOptions}
              style={{ minWidth: 180 }}
              showSearch
              optionFilterProp="label"
            />
            <Button
              type="primary"
              size="small"
              onClick={handleCompare}
              loading={loadingDiff}
              disabled={fromKey === null || toKey === null || fromKey === toKey}
            >
              对比
            </Button>

            {diffSummary && (
              <div className="version-diff__toolbar-summary">
                {diffSummary.added > 0 && (
                  <Tag className="version-diff__summary-tag version-diff__summary-tag--added">
                    +{diffSummary.added} 新增
                  </Tag>
                )}
                {diffSummary.deleted > 0 && (
                  <Tag className="version-diff__summary-tag version-diff__summary-tag--deleted">
                    -{diffSummary.deleted} 删除
                  </Tag>
                )}
                {diffSummary.modified > 0 && (
                  <Tag className="version-diff__summary-tag version-diff__summary-tag--modified">
                    ~{diffSummary.modified} 修改
                  </Tag>
                )}
                {diffSummary.moved > 0 && (
                  <Tag className="version-diff__summary-tag version-diff__summary-tag--moved">
                    →{diffSummary.moved} 移动
                  </Tag>
                )}
                <Button size="small" icon={<CloseCircleOutlined />} onClick={handleCancelDiff}>
                  取消对比
                </Button>
              </div>
            )}
          </div>

          {selectedKey !== null && !diffHtml && (
            <div className="version-diff__version-bar">
              <strong>{getRefLabel(selectedKey)}</strong>
              <span>{getRefTime(selectedKey)}</span>
              <span>{getRefMessage(selectedKey)}</span>
              {canRevertSelectedVersion && (
                <Button size="small" danger onClick={openRevertDialog}>
                  回退到此版本
                </Button>
              )}
            </div>
          )}

          {fromKey && toKey && diffHtml && (
            <div className="version-diff__version-bar">
              <strong>{getRefLabel(fromKey)}</strong>
              <span>{getRefTime(fromKey)}</span>
              <span style={{ margin: "0 4px", color: "var(--app-text-muted)" }}>→</span>
              <strong>{getRefLabel(toKey)}</strong>
              <span>{getRefTime(toKey)}</span>
            </div>
          )}

          <div className="version-diff__content">
            {loadingSingle || loadingDiff ? (
              <div className="version-diff__loading">
                <Spin />
              </div>
            ) : noVisibleDiff ? (
              <Empty description="所选草稿与版本没有可见差异" style={{ marginTop: 120 }} />
            ) : renderedHtml ? (
              <>
                <div
                  className={`version-diff__doc-shell tiptap-card ${
                    diffHtml ? "version-diff__doc-shell--diff" : "version-diff__preview"
                  }`}
                >
                  <div
                    className={`version-diff__editor-content doc-content tiptap-editor ${
                      diffHtml ? "version-diff__diff-view" : "version-diff__preview"
                    }`}
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
                </div>
                <DeferredCodeBlockRenderer key={renderedHtmlKey} />
              </>
            ) : (
              <Empty description="选择一个版本或草稿查看内容" style={{ marginTop: 120 }} />
            )}
          </div>
        </main>
      </div>
      <Modal
        open={revertTargetVersion !== null}
        title={draftMeta.exists ? `回退到 v${revertTargetVersion ?? ""}` : "确认回退"}
        onCancel={() => setRevertTargetVersion(null)}
        footer={
          draftMeta.exists
            ? [
                <Button key="cancel" onClick={() => setRevertTargetVersion(null)} disabled={reverting}>
                  取消
                </Button>,
                <Button
                  key="discard"
                  onClick={() => void executeRevert("discard")}
                  loading={reverting}
                >
                  丢弃草稿并回退
                </Button>,
                <Button
                  key="preserve"
                  type="primary"
                  onClick={() => void executeRevert("preserve")}
                  loading={reverting}
                >
                  保存草稿并回退
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setRevertTargetVersion(null)} disabled={reverting}>
                  取消
                </Button>,
                <Button
                  key="confirm"
                  type="primary"
                  danger
                  onClick={() => void executeRevert()}
                  loading={reverting}
                >
                  确认回退
                </Button>,
              ]
        }
        destroyOnHidden
      >
        {draftMeta.exists ? (
          <p>当前存在草稿。请选择先保存草稿还是丢弃草稿，然后回退到 v{revertTargetVersion ?? ""}。</p>
        ) : (
          <p>回退会生成一个新的保存版本：回退到 v{revertTargetVersion ?? ""}。</p>
        )}
      </Modal>
    </Modal>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
