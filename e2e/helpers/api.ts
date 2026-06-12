import { encodeDocId } from "../../src/lib/doc-slug";

export const API_BASE =
  process.env.PLAYWRIGHT_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:5200/api/v1";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface E2EAuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  workspaceId: string;
}

export interface E2EDocument {
  docId: string;
  rootBlockId: string;
  slug: string;
  editPath: string;
}

async function apiRequest<T>(
  method: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(
      `API ${method} ${path} failed (${response.status}): ${payload.message ?? response.statusText}`,
    );
  }

  return payload.data;
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function registerE2EUser(): Promise<E2EAuthSession> {
  const suffix = uniqueSuffix();
  const registerData = await apiRequest<{
    user: { userId: string };
    accessToken: string;
    refreshToken: string;
  }>("POST", "/auth/register", {
    body: {
      username: `e2e_${suffix}`,
      email: `e2e_${suffix}@sync-test.local`,
      password: "E2eSyncTest!234",
      displayName: "E2E Sync Tester",
    },
  });

  const workspace = await apiRequest<{ workspaceId: string }>("POST", "/workspaces", {
    token: registerData.accessToken,
    body: {
      name: `E2E Workspace ${suffix}`,
      description: "Playwright sync regression workspace",
    },
  });

  return {
    accessToken: registerData.accessToken,
    refreshToken: registerData.refreshToken,
    userId: registerData.user.userId,
    workspaceId: workspace.workspaceId,
  };
}

export async function createE2EDocument(
  session: E2EAuthSession,
  title = "E2E Sync Document",
): Promise<E2EDocument> {
  const document = await apiRequest<{ docId: string; rootBlockId: string }>("POST", "/documents", {
    token: session.accessToken,
    body: {
      workspaceId: session.workspaceId,
      title,
    },
  });

  const slug = encodeDocId(document.docId);
  return {
    docId: document.docId,
    rootBlockId: document.rootBlockId,
    slug,
    editPath: `/dash/edit/${slug}`,
  };
}

export interface EditContentBlockTree {
  blockId: string;
  type: string;
  children?: EditContentBlockTree[];
  payload?: {
    attrs?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string }>;
  };
}

export interface EditContentSnapshot {
  source: "draft" | "head";
  draftRevision: number | null;
  tree: EditContentBlockTree;
}

export async function fetchEditContentSnapshot(
  session: E2EAuthSession,
  docId: string,
): Promise<EditContentSnapshot> {
  const data = await apiRequest<{
    source: "draft" | "head";
    draft: { draftRevision?: number | null };
    tree: EditContentBlockTree;
  }>("GET", `/documents/${docId}/edit-content`, {
    token: session.accessToken,
  });

  return {
    source: data.source,
    draftRevision: data.draft.draftRevision ?? null,
    tree: data.tree,
  };
}

function isDeletedBlock(node: EditContentBlockTree): boolean {
  const attrs = node.payload?.attrs;
  return attrs?.deleted === true || attrs?.deleted === "true";
}

export function flattenBlockTexts(tree: EditContentBlockTree): string[] {
  const texts: string[] = [];
  const walk = (node: EditContentBlockTree) => {
    if (isDeletedBlock(node)) {
      return;
    }
    const inlineText = (node.payload?.content ?? [])
      .map((item) => item.text ?? "")
      .join("")
      .trim();
    if (inlineText) {
      texts.push(inlineText);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(tree);
  return texts;
}

export function countBlocksWithText(tree: EditContentBlockTree): number {
  return flattenBlockTexts(tree).length;
}
