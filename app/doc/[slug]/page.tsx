import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ClockCircleOutlined, EyeOutlined } from "@ant-design/icons";
import DeferredCodeBlockRenderer from "@/components/DeferredCodeBlockRenderer";
import { DocPageLayout } from "@/components/DocPageLayout";
import { PublicDocTOC } from "@/components/PublicDocTOC";
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
        <div className="doc-footer-meta-item">
          <div className="doc-author-avatar">
            {doc.authorAvatar ? (
              <img
                src={doc.authorAvatar}
                alt="avatar"
                style={{ width: "100%", height: "100%", borderRadius: "50%" }}
              />
            ) : (
              doc.authorName.charAt(0).toUpperCase()
            )}
          </div>
          <span>{doc.authorName}</span>
        </div>
        {doc.category && <span>{doc.category}</span>}
        <span className="doc-footer-meta-item">
          <ClockCircleOutlined /> {formatDate(doc.updatedAt)}
        </span>
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
      <DeferredCodeBlockRenderer />

      <footer className="doc-footer">
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

        <div className="doc-footer-meta">
          <div className="doc-footer-meta-item desktop-only">
            <div className="doc-author-avatar">
              {doc.authorAvatar ? (
                <img
                  src={doc.authorAvatar}
                  alt="avatar"
                  style={{ width: "100%", height: "100%", borderRadius: "50%" }}
                />
              ) : (
                doc.authorName.charAt(0).toUpperCase()
              )}
            </div>
            <span>{doc.authorName}</span>
          </div>
          {doc.category && <span className="desktop-only">{doc.category}</span>}
          <span className="doc-footer-meta-item desktop-only">
            <ClockCircleOutlined /> {formatDate(doc.updatedAt)}
          </span>
          <span className="doc-footer-meta-item" style={{ marginLeft: "auto" }}>
            <EyeOutlined /> {doc.viewCount} {"\u6D4F\u89C8"}
          </span>
        </div>
      </footer>
    </DocPageLayout>
  );
}
