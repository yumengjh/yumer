import { apiGet } from "./api-client";

export type SearchTargetType = "doc" | "block" | "all";

export interface SearchParams {
  query: string;
  workspaceId?: string;
  page?: number;
  pageSize?: number;
  type?: SearchTargetType;
}

export interface SearchDocumentItem {
  type: "document";
  docId: string;
  title: string;
  icon?: string;
  workspaceId: string;
  rank?: number;
}

export interface SearchBlockItem {
  type: "block";
  blockId: string;
  docId: string;
  docTitle: string;
  content: string;
  rank?: number;
}

export type SearchItem = SearchDocumentItem | SearchBlockItem;

export interface SearchResponse {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface SearchDocumentsPayload {
  items?: Array<{
    docId: string;
    title: string;
    icon?: string;
    workspaceId: string;
    rank?: number;
  }>;
  total?: number;
  page?: number;
  pageSize?: number;
}

interface SearchBlocksPayload {
  items?: Array<{
    blockId: string;
    docId: string;
    docTitle: string;
    content?: string;
    plainText?: string;
    rank?: number;
  }>;
  total?: number;
  page?: number;
  pageSize?: number;
}

type SearchResponseLike =
  | (Partial<SearchResponse> & {
      documents?: SearchDocumentsPayload | null;
      blocks?: SearchBlocksPayload | null;
    })
  | null
  | undefined;

export function buildSearchQueryString(params: SearchParams): string {
  const query = new URLSearchParams();
  query.set("query", params.query);

  if (params.workspaceId) query.set("workspaceId", params.workspaceId);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.type) query.set("type", params.type);

  return query.toString();
}

export function normalizeSearchResponse(response: SearchResponseLike): SearchResponse {
  const directItems = Array.isArray(response?.items) ? response.items : null;

  if (directItems) {
    return {
      items: directItems,
      total: typeof response?.total === "number" ? response.total : directItems.length,
      page: typeof response?.page === "number" ? response.page : 1,
      pageSize: typeof response?.pageSize === "number" ? response.pageSize : 10,
    };
  }

  const documentItems: SearchDocumentItem[] = Array.isArray(response?.documents?.items)
    ? response.documents.items.map((item) => ({
        type: "document",
        docId: item.docId,
        title: item.title,
        icon: item.icon,
        workspaceId: item.workspaceId,
        rank: item.rank,
      }))
    : [];

  const blockItems: SearchBlockItem[] = Array.isArray(response?.blocks?.items)
    ? response.blocks.items.map((item) => ({
        type: "block",
        blockId: item.blockId,
        docId: item.docId,
        docTitle: item.docTitle,
        content: item.content ?? item.plainText ?? "",
        rank: item.rank,
      }))
    : [];

  const page =
    typeof response?.documents?.page === "number"
      ? response.documents.page
      : typeof response?.blocks?.page === "number"
        ? response.blocks.page
        : 1;

  const pageSize =
    typeof response?.documents?.pageSize === "number"
      ? response.documents.pageSize
      : typeof response?.blocks?.pageSize === "number"
        ? response.blocks.pageSize
        : 10;

  const total =
    (typeof response?.documents?.total === "number" ? response.documents.total : documentItems.length) +
    (typeof response?.blocks?.total === "number" ? response.blocks.total : blockItems.length);

  return {
    items: [...documentItems, ...blockItems],
    total,
    page,
    pageSize,
  };
}

export async function searchDocuments(params: SearchParams): Promise<SearchResponse> {
  const query = buildSearchQueryString(params);
  const response = await apiGet<SearchResponseLike>(`/search?${query}`);
  return normalizeSearchResponse(response);
}
