import { notFound } from "next/navigation";
import type { Metadata } from "next";
import sanitizeHtml from "sanitize-html";
import { decodeDocSlug } from "@/lib/doc-slug";
import { highlightCodeBlocks } from "@/lib/highlight";
import { renderBlockTreeToHtml } from "@/services/generate-block-html";
import { DocPageLayout } from "@/components/DocPageLayout";
import { PublicDocTOC } from "@/components/PublicDocTOC";
import { ClockCircleOutlined, EyeOutlined } from "@ant-design/icons";
import "@/components/markdown-editor/styles/editor.css";
import "./style.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api-zzz.yumgjs.com/api/v1";

interface Block {
  blockId: string;
  type: string;
  payload: Record<string, unknown>;
  sortKey?: string;
  children?: Block[];
}

interface ContentResponse {
  docId: string;
  title: string;
  tree: Block;
}

interface DocumentUserSummary {
  userId: string;
  displayName: string | null;
  avatar: string | null;
}

interface DocumentMetaResponse {
  workspaceId?: string;
  icon?: string | null;
  category?: string | null;
  tags?: string[];
  updatedAt?: string;
  viewCount?: number;
  creator?: DocumentUserSummary | null;
  updater?: DocumentUserSummary | null;
}

async function getDocContent(slug: string) {
  let docId: string;
  try {
    docId = decodeDocSlug(slug);
  } catch {
    return null;
  }

  const [contentRes, docRes] = await Promise.all([
    fetch(`${API_BASE}/documents/${docId}/content`, { cache: "no-store" }),
    fetch(`${API_BASE}/documents/${docId}`, { cache: "no-store" }),
  ]);

  if (!contentRes.ok || !docRes.ok) return null;
  
  const [contentJson, docJson] = await Promise.all([
    contentRes.json(),
    docRes.json(),
  ]);

  if (!contentJson.success || !docJson.success) return null;

  const data: ContentResponse = contentJson.data;
  const docData: DocumentMetaResponse = docJson.data;
  
  // Fetch tags to resolve tag metadata
  let tagsWithInfo: any[] = [];
  if (docData.tags && docData.tags.length > 0 && docData.workspaceId) {
    try {
      const tagsRes = await fetch(`${API_BASE}/tags?workspaceId=${docData.workspaceId}&pageSize=100`, { cache: "no-store" });
      if (tagsRes.ok) {
        const tagsJson = await tagsRes.json();
        if (tagsJson.success) {
          const tagInfoMap = new Map(
            tagsJson.data.items.map((tag: any) => [tag.tagId, { name: tag.name, color: tag.color }])
          );
          tagsWithInfo = docData.tags.map((tagId: string) => {
            const tagInfo = tagInfoMap.get(tagId);
            return tagInfo ? { tagId, ...tagInfo } : null;
          }).filter(Boolean);
        }
      }
    } catch (e) {
      // Ignore tag fetch error
    }
  }

  const rawHtml = renderBlockTreeToHtml(data.tree);
  const highlighted = await highlightCodeBlocks(rawHtml);
  const html = sanitizeHtml(highlighted, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "span",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class", "style", "data-*", "blockId", "clientId"],
      a: ["href", "name", "target", "rel", "class"],
      img: ["src", "alt", "title", "width", "height", "class"],
      code: ["class", "data-language"],
      pre: ["class", "data-language"],
      span: ["class", "style", "data-*"],
      th: ["colspan", "rowspan", "style", "class"],
      td: ["colspan", "rowspan", "style", "class"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
  });
  return { 
    title: data.title, 
    html, 
    workspaceId: docData.workspaceId,
    icon: docData.icon || undefined,
    category: docData.category || undefined,
    tags: tagsWithInfo,
    updatedAt: docData.updatedAt,
    authorName: docData.creator?.displayName || "\u672A\u77E5\u4F5C\u8005",
    authorAvatar: docData.creator?.avatar || null,
    viewCount: docData.viewCount || 0
  };
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocContent(slug);
  return { title: doc?.title || "文档不存在" };
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = await getDocContent(slug);

  if (!doc) {
    notFound();
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-CN", { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(/\//g, '-');
  };

  return (
    <DocPageLayout
      title={doc.title}
      icon={doc.icon}
      workspaceId={doc.workspaceId}
      sidebar={<PublicDocTOC />}
    >
      <h1 className="doc-main-title">{doc.title || "无标题"}</h1>
      
      <div className="doc-mobile-meta">
        <div className="doc-footer-meta-item">
          <div className="doc-author-avatar">
            {doc.authorAvatar ? (
              <img src={doc.authorAvatar} alt="avatar" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
            ) : (
              doc.authorName.charAt(0).toUpperCase()
            )}
          </div>
          <span>{doc.authorName}</span>
        </div>
        {doc.category && <span>{doc.category}</span>}
        <span className="doc-footer-meta-item"><ClockCircleOutlined /> {formatDate(doc.updatedAt)}</span>
      </div>

          <div
            className="doc-content tiptap-editor"
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />

          <footer className="doc-footer">
            {doc.tags && doc.tags.length > 0 && (
              <div className="doc-tags-list">
                {doc.tags.map((t: any) => (
                  <span key={t.tagId} className="doc-tag-badge">
                    <span className="doc-tag-dot" style={{ backgroundColor: t.color || '#ccc' }}></span>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
            
            <div className="doc-footer-meta">
              <div className="doc-footer-meta-item desktop-only">
                <div className="doc-author-avatar">
                  {doc.authorAvatar ? (
                    <img src={doc.authorAvatar} alt="avatar" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                  ) : (
                    doc.authorName.charAt(0).toUpperCase()
                  )}
                </div>
                <span>{doc.authorName}</span>
              </div>
              {doc.category && <span className="desktop-only">{doc.category}</span>}
              <span className="doc-footer-meta-item desktop-only"><ClockCircleOutlined /> {formatDate(doc.updatedAt)}</span>
              <span className="doc-footer-meta-item" style={{ marginLeft: "auto" }}>
                <EyeOutlined /> {doc.viewCount} 浏览
              </span>
            </div>
          </footer>
    </DocPageLayout>
  );
}
