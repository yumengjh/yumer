import { apiGet, apiPost, apiPatch, apiDelete } from "./api-client";
import {
  isLegacyDocument,
  tiptapJsonToBlocks,
  blocksToTiptapJson,
  extractPlainText,
  type TiptapDoc,
  type TiptapNode,
} from "./tiptap-converter";

// ─── 类型定义 ───

export interface DocumentUserSummary {
  userId: string;
  displayName: string | null;
  avatar: string | null;
}

export interface Document {
  docId: string;
  workspaceId: string;
  title: string;
  icon?: string;
  cover?: string;
  visibility: string;
  status: string;
  parentId?: string;
  rootBlockId: string;
  head: number;
  publishedHead?: number;
  tags?: string[];
  category?: string;
  createdBy?: string;
  updatedBy?: string;
  creator?: DocumentUserSummary | null;
  updater?: DocumentUserSummary | null;
  viewCount?: number;
  favoriteCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicDocRevalidationResult {
  attempted: boolean;
  success: boolean;
  skippedReason?: "not_public" | "missing_config" | "invalid_slug";
  slug?: string;
  status?: number;
  responseBody?: string;
  error?: string;
}

export interface PublishDocumentResult {
  document: Document;
  revalidation: PublicDocRevalidationResult;
}

export interface Block {
  blockId: string;
  docId: string;
  type: string;
  payload: Record<string, unknown>;
  parentId?: string;
  sortKey: string;
  indent: number;
  collapsed: boolean;
  children?: Block[];
}

// API 返回的文档内容结构
export interface DocumentContentResponse {
  docId: string;
  docVer: number;
  title: string;
  tree: Block; // 单个根块对象（不是数组！）
  pagination?: {
    totalBlocks: number;
    returnedBlocks: number;
    hasMore: boolean;
    nextStartBlockId?: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 批量操作类型 — blockId 在顶层（update/delete）
interface BatchCreateOp {
  type: "create";
  data: {
    docId: string;
    type: string;
    payload: Record<string, unknown>;
    parentId?: string;
    sortKey?: string;
  };
}

interface BatchUpdateOp {
  type: "update";
  blockId: string;
  data: {
    payload: Record<string, unknown>;
    plainText?: string;
  };
}

interface BatchDeleteOp {
  type: "delete";
  blockId: string;
}

type BatchOperation = BatchCreateOp | BatchUpdateOp | BatchDeleteOp;

// ─── 文档 CRUD ───

export async function createDocument(data: {
  workspaceId: string;
  title: string;
  icon?: string;
  cover?: string;
  visibility?: string;
  category?: string;
}): Promise<Document> {
  return apiPost<Document>("/documents", data);
}

export async function listDocuments(params: {
  workspaceId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: string;
}): Promise<PaginatedResponse<Document>> {
  const query = new URLSearchParams();
  if (params.workspaceId) query.set("workspaceId", params.workspaceId);
  if (params.status) query.set("status", params.status);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortOrder) query.set("sortOrder", params.sortOrder);
  return apiGet<PaginatedResponse<Document>>(
    `/documents?${query.toString()}`,
  );
}

export async function getDocument(docId: string): Promise<Document> {
  return apiGet<Document>(`/documents/${docId}`);
}

export async function getDocumentContent(
  docId: string,
): Promise<DocumentContentResponse> {
  return apiGet<DocumentContentResponse>(`/documents/${docId}/content`);
}

export async function deleteDocument(docId: string): Promise<void> {
  return apiDelete(`/documents/${docId}`);
}

export async function updateDocument(
  docId: string,
  data: {
    title?: string;
    icon?: string;
    cover?: string;
    visibility?: string;
    tags?: string[];
    category?: string;
    status?: string;
  },
): Promise<Document> {
  return apiPatch<Document>(`/documents/${docId}`, data);
}

export async function commitVersion(
  docId: string,
  message?: string,
): Promise<void> {
  await apiPost(`/documents/${docId}/commit`, { message });
}

export async function publishDocument(
  docId: string,
): Promise<PublishDocumentResult> {
  return apiPost<PublishDocumentResult>(`/documents/${docId}/publish`);
}

// ─── 块操作 ───

const BATCH_SIZE = 100;

async function batchOperations(
  docId: string,
  operations: BatchOperation[],
): Promise<void> {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const chunk = operations.slice(i, i + BATCH_SIZE);
    await apiPost("/blocks/batch", { docId, operations: chunk });
  }
}

// ─── HTML↔块 桥接 ───

/** 从 HTML 标签推断块 type */
function inferBlockType(html: string): string {
  const tag = html.match(/^<([a-z][a-z0-9]*)/i)?.[1]?.toLowerCase();
  if (!tag) return "paragraph";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "pre") return "code";
  if (tag === "table") return "table";
  if (tag === "blockquote") return "blockquote";
  if (tag === "hr") return "hr";
  return "paragraph";
}

/** 将 TipTap 输出的 HTML 拆分为顶级节点的 HTML 字符串数组 */
function splitHtmlToTopLevelNodes(html: string): string[] {
  if (!html.trim()) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  const nodes: string[] = [];
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) {
        nodes.push(`<p>${text}</p>`);
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      nodes.push(el.outerHTML);
    }
  }
  return nodes;
}

/** 剥离 HTML 字符串中的 data-block-id 属性 */
function stripDataBlockId(html: string): string {
  return html.replace(/\s+data-block-id="[^"]*"/g, "");
}

/** 将块数组拼接为完整 HTML，可选注入 data-block-id 属性 */
function blocksToHtml(blocks: Block[], blockIdMap?: Map<number, string>): string {
  return blocks
    .map((b, i) => {
      const html = (b.payload?.html as string) || "";
      if (!html || !blockIdMap) return html;
      const blockId = blockIdMap.get(i);
      if (!blockId) return html;
      // 在顶级元素的 > 之前注入 data-block-id
      return html.replace(/^(\s*<[^>\s]+)/, `$1 data-block-id="${blockId}"`);
    })
    .filter(Boolean)
    .join("");
}

/** 从根块递归展平为排序后的数组（包含根块自身） */
export function flattenBlockTree(root: Block): Block[] {
  const result: Block[] = [root];
  function walk(block: Block) {
    if (block.children?.length) {
      for (const child of block.children) {
        result.push(child);
        walk(child);
      }
    }
  }
  walk(root);
  result.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return result;
}

export interface LoadContentResult {
  html: string;
  blockIdMap: Map<number, string>;
}

/**
 * 加载文档内容，返回 HTML 和 blockId 映射
 */
export async function loadDocumentContent(docId: string): Promise<LoadContentResult> {
  const resp = await getDocumentContent(docId);
  if (!resp.tree) return { html: "", blockIdMap: new Map() };

  const flatBlocks = flattenBlockTree(resp.tree);
  // 过滤掉 root 块，只保留内容块
  const contentBlocks = flatBlocks.filter((b) => b.type !== "root");

  // 构建 blockIdMap：index → blockId
  const blockIdMap = new Map<number, string>();
  contentBlocks.forEach((b, i) => blockIdMap.set(i, b.blockId));

  const html = blocksToHtml(contentBlocks, blockIdMap);
  return { html, blockIdMap };
}

/**
 * 保存文档内容：解析 HTML → 拆分顶级节点 → diff 已有块 → 批量增删改
 */
export async function saveDocumentContent(
  docId: string,
  html: string,
  rootBlockId: string,
): Promise<void> {
  // 1. 获取已有块
  const resp = await getDocumentContent(docId);
  const existingBlocks = resp.tree
    ? flattenBlockTree(resp.tree).filter((b) => b.type !== "root")
    : [];

  // 2. 解析新 HTML 为顶级节点，剥离 data-block-id 避免假差异
  const newNodes = splitHtmlToTopLevelNodes(html).map(stripDataBlockId);

  // 3. Diff：逐个对比
  const operations: BatchOperation[] = [];
  const maxLen = Math.max(existingBlocks.length, newNodes.length);

  for (let i = 0; i < maxLen; i++) {
    const existing = existingBlocks[i];
    const newNodeHtml = newNodes[i];

    if (existing && newNodeHtml) {
      const existingHtml = (existing.payload?.html as string) || "";
      if (existingHtml !== newNodeHtml) {
        operations.push({
          type: "update",
          blockId: existing.blockId,
          data: { payload: { html: newNodeHtml } },
        });
      }
    } else if (!existing && newNodeHtml) {
      operations.push({
        type: "create",
        data: {
          docId,
          type: inferBlockType(newNodeHtml),
          payload: { html: newNodeHtml },
          parentId: rootBlockId,
        },
      });
    } else if (existing && !newNodeHtml) {
      operations.push({
        type: "delete",
        blockId: existing.blockId,
      });
    }
  }

  // 4. 执行批量操作
  if (operations.length > 0) {
    await batchOperations(docId, operations);
  }
}

// ─── V2：双格式加载/保存 ───

export type EditorContent = string | TiptapDoc;

/**
 * 加载文档内容（V2）
 * - 旧格式（payload.html）→ 返回 HTML 字符串
 * - 新格式（结构化 JSON）→ 返回 TiptapDoc
 */
export async function loadDocumentContentV2(
  docId: string,
): Promise<{ content: EditorContent; blockIds: string[]; docVer: number }> {
  const resp = await getDocumentContent(docId);
  if (!resp.tree) return { content: "", blockIds: [], docVer: resp.docVer };

  const flatBlocks = flattenBlockTree(resp.tree);
  const contentBlocks = flatBlocks.filter((b) => b.type !== "root");

  if (contentBlocks.length === 0) return { content: "", blockIds: [], docVer: resp.docVer };

  const blockIds = contentBlocks.map((b) => b.blockId);

  if (isLegacyDocument(contentBlocks)) {
    // 旧格式：拼接 HTML，注入 data-block-id
    const blockIdMap = new Map<number, string>();
    contentBlocks.forEach((b, i) => blockIdMap.set(i, b.blockId));
    const html = blocksToHtml(contentBlocks, blockIdMap);
    return { content: html, blockIds, docVer: resp.docVer };
  }

  // 新格式：重组为 Tiptap JSON
  const tiptapDoc = blocksToTiptapJson(contentBlocks);
  return { content: tiptapDoc, blockIds, docVer: resp.docVer };
}

/**
 * 保存文档内容（V2）
 * - HTML 字符串 → 旧逻辑（位置 diff）
 * - TiptapDoc JSON → 新逻辑（blockId 精确匹配 diff）
 */
export async function saveDocumentContentV2(
  docId: string,
  content: EditorContent,
  rootBlockId: string,
): Promise<void> {
  if (typeof content === "string") {
    await saveDocumentContent(docId, content, rootBlockId);
    return;
  }
  throw new Error(
    "saveDocumentContentV2 is no longer the autosync path for TipTap JSON documents",
  );
}

/** JSON 保存路径：基于 blockId 精确匹配 diff */
async function saveJsonContent(
  docId: string,
  tiptapDoc: TiptapDoc,
  rootBlockId: string,
): Promise<void> {
  const resp = await getDocumentContent(docId);
  const existingBlocks = resp.tree
    ? flattenBlockTree(resp.tree).filter((b) => b.type !== "root")
    : [];

  const existingMap = new Map<string, Block>();
  for (const block of existingBlocks) {
    existingMap.set(block.blockId, block);
  }

  const newBlockPayloads = tiptapJsonToBlocks(tiptapDoc);
  const operations: BatchOperation[] = [];
  const matchedIds = new Set<string>();
  let sortKeyCounter = 0;

  for (const newBlock of newBlockPayloads) {
    sortKeyCounter++;
    const sortKey = String(sortKeyCounter * 1000).padStart(6, "0");

    // 尝试通过现有 blockIds 匹配
    const existingBlock = newBlock.blockId
      ? existingMap.get(newBlock.blockId)
      : undefined;

    if (existingBlock) {
      matchedIds.add(existingBlock.blockId);
      const existingPayload = existingBlock.payload;
      const newPayload = newBlock.payload;

      if (
        createPayloadFingerprint(existingPayload) !==
        createPayloadFingerprint(newPayload)
      ) {
        operations.push({
          type: "update",
          blockId: existingBlock.blockId,
          data: {
            payload: newPayload,
            plainText: extractPlainText(newPayload as unknown as TiptapNode),
          },
        });
      }
    } else {
      operations.push({
        type: "create",
        data: {
          docId,
          type: newBlock.type,
          payload: newBlock.payload,
          parentId: rootBlockId,
          sortKey,
        },
      });
    }
  }

  for (const existing of existingBlocks) {
    if (!matchedIds.has(existing.blockId)) {
      operations.push({ type: "delete", blockId: existing.blockId });
    }
  }

  if (operations.length > 0) {
    await batchOperations(docId, operations);
  }
}

function createPayloadFingerprint(payload: unknown): string {
  const normalized = normalizePayload(payload);
  return JSON.stringify(normalized);
}

function normalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const keys = Object.keys(raw).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const next = normalizePayload(raw[key]);
    if (next === undefined) continue;
    out[key] = next;
  }

  if (out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    const attrs = { ...(out.attrs as Record<string, unknown>) };
    delete attrs.blockId;
    delete attrs.clientId;
    delete attrs["data-block-id"];
    delete attrs["data-client-id"];
    out.attrs = attrs;
  }

  return out;
}

// ─── 修订历史 / Diff API ───

export interface Revision {
  revisionId: string;
  docVer: number;
  message: string;
  createdAt: string;
  createdBy: string;
}

export interface RevisionsResponse {
  items: Revision[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DiffChange {
  type: "added" | "deleted" | "modified" | "moved" | "reordered" | "indent-changed";
  blockId: string;
  from?: {
    ver: number;
    type: string;
    payload: Record<string, unknown>;
    parentId: string;
    sortKey: string;
    indent: number;
    hash: string;
  };
  to?: {
    ver: number;
    type: string;
    payload: Record<string, unknown>;
    parentId: string;
    sortKey: string;
    indent: number;
    hash: string;
  };
}

export interface DiffSummary {
  added: number;
  deleted: number;
  modified: number;
  moved: number;
  reordered: number;
  indentChanged: number;
  unchanged: number;
}

export interface DiffResponse {
  docId: string;
  fromVer: number;
  toVer: number;
  summary: DiffSummary;
  changes: DiffChange[];
  fromContent: { tree: Block; totalBlocks: number; returnedBlocks: number; hasMore: boolean };
  toContent: { tree: Block; totalBlocks: number; returnedBlocks: number; hasMore: boolean };
}

export async function getRevisions(
  docId: string,
  page = 1,
  pageSize = 100,
): Promise<RevisionsResponse> {
  return apiGet<RevisionsResponse>(
    `/documents/${docId}/revisions?page=${page}&pageSize=${pageSize}`,
  );
}

export async function getVersionContent(
  docId: string,
  version: number,
): Promise<DocumentContentResponse> {
  return apiGet<DocumentContentResponse>(
    `/documents/${docId}/content?version=${version}`,
  );
}

export async function getVersionDiff(
  docId: string,
  fromVer: number,
  toVer: number,
): Promise<DiffResponse> {
  return apiGet<DiffResponse>(
    `/documents/${docId}/diff?fromVer=${fromVer}&toVer=${toVer}`,
  );
}
