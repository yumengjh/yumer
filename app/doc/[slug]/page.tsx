import { notFound } from "next/navigation";
import type { Metadata } from "next";
import sanitizeHtml from "sanitize-html";
import { decodeDocSlug } from "@/lib/doc-slug";
import { renderBlockTreeToHtml } from "@/services/generate-block-html";
import ClientCodeBlockRenderer from "@/components/ClientCodeBlockRenderer";
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
  html?: string | null;
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

interface TagSummary {
  tagId: string;
  name: string;
  color?: string | null;
}

interface RenderHeaderInfo {
  contentMode: string | null;
  renderMode: string | null;
  renderCache: string | null;
  renderBlocks: string | null;
  renderVersion: string | null;
}

function readRenderHeaderInfo(headers: Headers): RenderHeaderInfo {
  return {
    contentMode: headers.get("x-yuediter-content-mode"),
    renderMode: headers.get("x-yuediter-render-mode"),
    renderCache: headers.get("x-yuediter-render-cache"),
    renderBlocks: headers.get("x-yuediter-render-blocks"),
    renderVersion: headers.get("x-yuediter-render-version"),
  };
}

async function getDocMetadata(slug: string): Promise<{ title: string } | null> {
  let docId: string;
  try {
    docId = decodeDocSlug(slug);
  } catch {
    return null;
  }

  const docRes = await fetch(`${API_BASE}/documents/${docId}`, { cache: "no-store" });
  if (!docRes.ok) return null;

  const docJson = await docRes.json();
  if (!docJson.success) return null;

  const docData: DocumentMetaResponse & { title?: string } = docJson.data;
  return { title: docData.title || "无标题" };
}

async function getDocContent(slug: string) {
  let docId: string;
  try {
    docId = decodeDocSlug(slug);
  } catch {
    return null;
  }

  const [contentRes, docRes] = await Promise.all([
    fetch(`${API_BASE}/documents/${docId}/content?mode=all`, { cache: "no-store" }),
    fetch(`${API_BASE}/documents/${docId}`, { cache: "no-store" }),
  ]);

  if (!contentRes.ok || !docRes.ok) return null;
  const renderHeaders = readRenderHeaderInfo(contentRes.headers);
  
  const [contentJson, docJson] = await Promise.all([
    contentRes.json(),
    docRes.json(),
  ]);

  if (!contentJson.success || !docJson.success) return null;

  const data: ContentResponse = contentJson.data;
  const docData: DocumentMetaResponse = docJson.data;
  
  // Fetch tags to resolve tag metadata
  let tagsWithInfo: TagSummary[] = [];
  if (docData.tags && docData.tags.length > 0 && docData.workspaceId) {
    try {
      const tagsRes = await fetch(`${API_BASE}/tags?workspaceId=${docData.workspaceId}&pageSize=100`, { cache: "no-store" });
      if (tagsRes.ok) {
        const tagsJson = await tagsRes.json();
        if (tagsJson.success) {
          const tagInfoMap = new Map<string, Omit<TagSummary, "tagId">>(
            (tagsJson.data.items as TagSummary[]).map((tag) => [
              tag.tagId,
              { name: tag.name, color: tag.color },
            ])
          );
          tagsWithInfo = docData.tags.map((tagId: string) => {
            const tagInfo = tagInfoMap.get(tagId);
            return tagInfo ? { tagId, ...tagInfo } : null;
          }).filter((tag): tag is TagSummary => Boolean(tag));
        }
      }
    } catch {
      // Ignore tag fetch error
    }
  }

  const rawHtml = renderBlockTreeToHtml(data.tree);
  const html = sanitizeHtml(rawHtml, {
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
      div: ["class", "style", "data-*", "blockId", "clientId"],
      code: ["class", "data-language"],
      pre: ["class", "data-language"],
      span: ["class", "style", "data-*"],
      button: ["type", "class", "data-*"],
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
    viewCount: docData.viewCount || 0,
    renderHeaders,
  };
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocMetadata(slug);
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
            data-yuediter-content-mode={doc.renderHeaders.contentMode || undefined}
            data-yuediter-render-mode={doc.renderHeaders.renderMode || undefined}
            data-yuediter-render-cache={doc.renderHeaders.renderCache || undefined}
            data-yuediter-render-blocks={doc.renderHeaders.renderBlocks || undefined}
            data-yuediter-render-version={doc.renderHeaders.renderVersion || undefined}
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />
          <ClientCodeBlockRenderer />

          <footer className="doc-footer">
            {doc.tags && doc.tags.length > 0 && (
              <div className="doc-tags-list">
                {doc.tags.map((t: TagSummary) => (
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
