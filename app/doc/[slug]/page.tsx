import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DeferredCodeBlockRenderer from "@/components/DeferredCodeBlockRenderer";
import DeferredDocImagePreview from "@/components/DeferredDocImagePreview";
import { DocPageLayout } from "@/components/DocPageLayout";
import { PublicDocTOC } from "@/components/PublicDocTOC";
import { PublicHeadingAnchorEnhancer } from "@/components/PublicHeadingAnchorEnhancer";
import {
  getPublicDocSnapshot,
  isLatestRequest,
  type PublicDocSearchParams,
  type TagSummary,
} from "@/services/public-doc-snapshot";
import "@/components/markdown-editor/styles/editor.css";
import "./style.css";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<PublicDocSearchParams>;
};

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const latest = isLatestRequest(await searchParams);
  const doc = await getPublicDocSnapshot(slug, latest);
  return { title: doc?.title || "\u6587\u6863\u4E0D\u5B58\u5728" };
}

function formatDate(dateString?: string) {
  if (!dateString) return "";

  return new Date(dateString)
    .toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\//g, "-");
}

export default async function DocPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const latest = isLatestRequest(await searchParams);
  const doc = await getPublicDocSnapshot(slug, latest);

  if (!doc) {
    notFound();
  }

  return (
    <DocPageLayout
      title={doc.title}
      icon={doc.icon}
      workspaceId={doc.workspaceId}
      sidebar={<PublicDocTOC />}
    >
      <h1 className="doc-main-title">{doc.title || "\u65E0\u6807\u9898"}</h1>

      <div className="doc-mobile-meta">
        <span className="doc-meta-entry">
          <span className="doc-meta-label">作者</span>
          <span className="doc-meta-value">{doc.authorName}</span>
        </span>
        {doc.category && (
          <span className="doc-meta-entry">
            <span className="doc-meta-label">分类</span>
            <span className="doc-meta-value">{doc.category}</span>
          </span>
        )}
        {doc.updatedAt && (
          <span className="doc-meta-entry">
            <span className="doc-meta-label">更新</span>
            <time className="doc-meta-value" dateTime={doc.updatedAt}>
              {formatDate(doc.updatedAt)}
            </time>
          </span>
        )}
      </div>

      <div
        className="doc-content tiptap-editor"
        data-yuediter-content-mode={doc.renderHeaders.contentMode || undefined}
        data-yuediter-render-mode={doc.renderHeaders.renderMode || undefined}
        data-yuediter-render-cache={doc.renderHeaders.renderCache || undefined}
        data-yuediter-render-blocks={doc.renderHeaders.renderBlocks || undefined}
        data-yuediter-render-version={doc.renderHeaders.renderVersion || undefined}
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
      <PublicHeadingAnchorEnhancer />
      <DeferredCodeBlockRenderer />
      <DeferredDocImagePreview />

      <footer className="doc-footer">
        <div className="doc-footer-meta">
          <span className="doc-meta-entry desktop-only">
            <span className="doc-meta-label">作者</span>
            <span className="doc-meta-value">{doc.authorName}</span>
          </span>
          {doc.category && (
            <span className="doc-meta-entry desktop-only">
              <span className="doc-meta-label">分类</span>
              <span className="doc-meta-value">{doc.category}</span>
            </span>
          )}
          {doc.updatedAt && (
            <span className="doc-meta-entry desktop-only">
              <span className="doc-meta-label">更新</span>
              <time className="doc-meta-value" dateTime={doc.updatedAt}>
                {formatDate(doc.updatedAt)}
              </time>
            </span>
          )}
          <span className="doc-meta-entry doc-meta-entry--views">
            <span className="doc-meta-label">浏览</span>
            <span className="doc-meta-value">{doc.viewCount}</span>
          </span>
        </div>

        {doc.tags.length > 0 && (
          <div className="doc-tags-list">
            {doc.tags.map((tag: TagSummary) => (
              <span key={tag.tagId} className="doc-tag-badge">
                <span
                  className="doc-tag-dot"
                  style={{ backgroundColor: tag.color || "#ccc" }}
                />
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </footer>
    </DocPageLayout>
  );
}
