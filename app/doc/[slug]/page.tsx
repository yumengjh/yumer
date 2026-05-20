import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DOMPurify from "isomorphic-dompurify";
import { decodeDocSlug } from "@/lib/doc-slug";
import { highlightCodeBlocks } from "@/lib/highlight";
import { renderBlockTreeToHtml } from "@/services/generate-block-html";
import { PublicDocHeader } from "@/components/PublicDocHeader";
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
  const docData = docJson.data;
  const rawHtml = renderBlockTreeToHtml(data.tree);
  const highlighted = await highlightCodeBlocks(rawHtml);
  const html = DOMPurify.sanitize(highlighted, {
    ADD_TAGS: ["code", "pre", "span"],
    ADD_ATTR: ["class", "data-language", "data-block-id", "style"],
  });
  return { title: data.title, html, icon: docData.icon };
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

  return (
    <div className="doc-page">
      <PublicDocHeader title={doc.title} icon={doc.icon} />
      <div className="tiptap-shell">
        <div className="tiptap-card">
          <div className="tiptap-editor-wrapper">
            <div
              className="doc-content tiptap-editor"
              dangerouslySetInnerHTML={{ __html: doc.html }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
