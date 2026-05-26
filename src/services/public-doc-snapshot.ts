import { unstable_cache } from "next/cache";
import sanitizeHtml from "sanitize-html";
import { cache } from "react";
import { decodeDocSlug } from "@/lib/doc-slug";
import { renderBlockTreeToHtml } from "@/services/generate-block-html";
import { fetchPublicDocContent } from "@/services/public-doc-content-fetch";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api-zzz.yumgjs.com/api/v1";
export const PUBLIC_DOC_REVALIDATE_SECONDS = 3600;

export type PublicDocSearchParams = {
  latest?: string | string[];
};

interface Block {
  blockId: string;
  type: string;
  payload: Record<string, unknown>;
  html?: string | null;
  sortKey?: string;
  children?: Block[];
}

interface ContentResponse {
  title: string;
  tree: Block;
}

interface DocumentUserSummary {
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
}

export interface TagSummary {
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

export interface PublicDocSnapshot {
  title: string;
  html: string;
  workspaceId?: string;
  icon?: string;
  category?: string;
  tags: TagSummary[];
  updatedAt?: string;
  authorName: string;
  authorAvatar: string | null;
  viewCount: number;
  renderHeaders: RenderHeaderInfo;
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

export function isLatestRequest(searchParams?: PublicDocSearchParams): boolean {
  const value = searchParams?.latest;
  return Array.isArray(value) ? value.includes("1") : value === "1";
}

export function getPublicDocCacheTag(slug: string): string {
  return `public-doc:${slug}`;
}

function publicFetchOptions(slug: string): RequestInit {
  return {
    next: {
      revalidate: PUBLIC_DOC_REVALIDATE_SECONDS,
      tags: [getPublicDocCacheTag(slug)],
    },
  };
}

function resolvePublicFetchOptions(slug: string, latest: boolean): RequestInit {
  return latest ? ({ cache: "no-store" } satisfies RequestInit) : publicFetchOptions(slug);
}

async function readPublicDocSnapshot(
  slug: string,
  latest: boolean,
): Promise<PublicDocSnapshot | null> {
  let docId: string;
  try {
    docId = decodeDocSlug(slug);
  } catch {
    return null;
  }

  const fetchOptions = resolvePublicFetchOptions(slug, latest);
  const contentUrl = `${API_BASE}/documents/${docId}/content?mode=html`;
  const fallbackContentUrl = `${API_BASE}/documents/${docId}/content`;

  let contentRes: Response;
  let docRes: Response;
  try {
    [contentRes, docRes] = await Promise.all([
      fetchPublicDocContent(contentUrl, fallbackContentUrl, fetchOptions),
      fetch(`${API_BASE}/documents/${docId}`, fetchOptions),
    ]);
  } catch {
    return null;
  }

  if (!contentRes.ok || !docRes.ok) {
    return null;
  }

  const renderHeaders = readRenderHeaderInfo(contentRes.headers);
  let contentJson: { success?: boolean; data?: ContentResponse };
  let docJson: { success?: boolean; data?: DocumentMetaResponse };
  try {
    [contentJson, docJson] = await Promise.all([contentRes.json(), docRes.json()]);
  } catch {
    return null;
  }

  if (!contentJson.success || !docJson.success || !contentJson.data || !docJson.data) {
    return null;
  }

  const data: ContentResponse = contentJson.data;
  const docData: DocumentMetaResponse = docJson.data;

  let tagsWithInfo: TagSummary[] = [];
  if (docData.tags && docData.tags.length > 0 && docData.workspaceId) {
    try {
      const tagsRes = await fetch(
        `${API_BASE}/tags?workspaceId=${docData.workspaceId}&pageSize=100`,
        fetchOptions,
      );
      if (tagsRes.ok) {
        const tagsJson = await tagsRes.json();
        if (tagsJson.success) {
          const tagInfoMap = new Map<string, Omit<TagSummary, "tagId">>(
            (tagsJson.data.items as TagSummary[]).map((tag) => [
              tag.tagId,
              { name: tag.name, color: tag.color },
            ]),
          );
          tagsWithInfo = docData.tags
            .map((tagId: string) => {
              const tagInfo = tagInfoMap.get(tagId);
              return tagInfo ? { tagId, ...tagInfo } : null;
            })
            .filter((tag): tag is TagSummary => Boolean(tag));
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
    title: data.title || "\u65E0\u6807\u9898",
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

async function getCachedPublicDocSnapshot(slug: string) {
  return unstable_cache(
    async () => readPublicDocSnapshot(slug, false),
    ["public-doc-snapshot", slug],
    {
      revalidate: PUBLIC_DOC_REVALIDATE_SECONDS,
      tags: [getPublicDocCacheTag(slug)],
    },
  )();
}

export const getPublicDocSnapshot = cache(async (slug: string, latest: boolean) =>
  latest ? readPublicDocSnapshot(slug, true) : getCachedPublicDocSnapshot(slug),
);
