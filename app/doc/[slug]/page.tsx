import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocFooter } from "@/components/DocFooter";
import DeferredCodeBlockRenderer from "@/components/DeferredCodeBlockRenderer";
import DeferredDocImagePreview from "@/components/DeferredDocImagePreview";
import { DocPageLayout } from "@/components/DocPageLayout";
import { DocumentTableOfContents, HeadingAnchorEnhancer } from "@/modules/viewer-kit";
import {
  getPublicDocSnapshot,
  isLatestRequest,
  type PublicDocSearchParams,
} from "@/services/public-doc-snapshot";
import "@/modules/content-styles/content.css";
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
  return { title: doc?.title || "文档不存在" };
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
      sidebar={
        <DocumentTableOfContents
          title="目录"
          expandAllLabel="全部展开"
          collapseAllLabel="全部收起"
        />
      }
      footer={
        <DocFooter
          authorName={doc.authorName}
          authorAvatar={doc.authorAvatar}
          category={doc.category}
          updatedAt={doc.updatedAt}
          viewCount={doc.viewCount}
          tags={doc.tags}
          workspaceId={doc.workspaceId}
        />
      }
    >
      <h1 className="doc-main-title">{doc.title || "无标题"}</h1>

      <div
        className="doc-content tiptap-editor"
        data-yuediter-content-mode={doc.renderHeaders.contentMode || undefined}
        data-yuediter-render-mode={doc.renderHeaders.renderMode || undefined}
        data-yuediter-render-cache={doc.renderHeaders.renderCache || undefined}
        data-yuediter-render-blocks={doc.renderHeaders.renderBlocks || undefined}
        data-yuediter-render-version={doc.renderHeaders.renderVersion || undefined}
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
      <HeadingAnchorEnhancer />
      <DeferredCodeBlockRenderer />
      <DeferredDocImagePreview />
    </DocPageLayout>
  );
}
