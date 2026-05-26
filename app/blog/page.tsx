import PublicPageClient from "./PublicPageClient";
import "../public/style.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api-zzz.yumgjs.com/api/v1";
const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID || "ws_1777597341536_714ae45b";

export interface DocItem {
  docId: string;
  title: string;
  icon?: string;
  publishedHead?: number;
  updatedAt: string;
  parentId?: string | null;
  wordCount?: number;
}

export interface WorkspaceInfo {
  workspaceId: string;
  name: string;
  description?: string;
  icon?: string;
  ownerId: string;
  documentCount: number;
  wordCount?: number;
  createdAt: string;
}

export interface UserInfo {
  userId: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

type FetchOutcome<T> =
  | { data: T; offline: false }
  | { data: null; offline: true }
  | { data: null; offline: false };

async function getWorkspaceInfo(workspaceId: string): Promise<FetchOutcome<WorkspaceInfo>> {
  try {
    const url = `${API_BASE}/workspaces/${workspaceId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { data: null, offline: false };
    const json = await res.json();
    if (!json.success) return { data: null, offline: false };
    return { data: json.data, offline: false };
  } catch {
    return { data: null, offline: true };
  }
}

async function getUserInfo(userId: string): Promise<UserInfo | null> {
  try {
    const url = `${API_BASE}/auth/users/${userId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success) return null;
    return json.data;
  } catch {
    return null;
  }
}

async function getPublishedDocs(workspaceId: string): Promise<FetchOutcome<DocItem[]>> {
  try {
    const url = `${API_BASE}/documents?workspaceId=${workspaceId}&sortBy=updatedAt&sortOrder=DESC&pageSize=100`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { data: [], offline: false };
    const json = await res.json();
    if (!json.success) return { data: [], offline: false };
    const items: DocItem[] = json.data?.items ?? [];
    return { data: items, offline: false };
  } catch {
    return { data: null, offline: true };
  }
}

function PublicEmptyState({ message }: { message: string }) {
  return (
    <div className="public-page-wrapper">
      <div className="blog">
        <p className="public-empty">{message}</p>
      </div>
    </div>
  );
}

export default async function BlogPage() {
  const [workspaceResult, docsResult] = await Promise.all([
    getWorkspaceInfo(WORKSPACE_ID),
    getPublishedDocs(WORKSPACE_ID),
  ]);

  if (workspaceResult.offline || docsResult.offline) {
    return (
      <PublicEmptyState message="无法连接文档服务，请确认后端已启动后刷新页面" />
    );
  }

  const workspace = workspaceResult.data;
  const docs = docsResult.data ?? [];

  if (!workspace) {
    return <PublicEmptyState message="工作空间不存在或未公开" />;
  }

  const owner = await getUserInfo(workspace.ownerId);

  return (
    <div className="public-page-wrapper">
      <PublicPageClient workspace={workspace} owner={owner} docs={docs} />
    </div>
  );
}
