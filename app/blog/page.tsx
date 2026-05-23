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

async function getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo | null> {
  const url = `${API_BASE}/workspaces/${workspaceId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.success) return null;
  return json.data;
}

async function getUserInfo(userId: string): Promise<UserInfo | null> {
  const url = `${API_BASE}/auth/users/${userId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.success) return null;
  return json.data;
}

async function getPublishedDocs(workspaceId: string): Promise<DocItem[]> {
  const url = `${API_BASE}/documents?workspaceId=${workspaceId}&sortBy=updatedAt&sortOrder=DESC&pageSize=100`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  if (!json.success) return [];
  const items: DocItem[] = json.data?.items ?? [];
  return items;
}

export default async function BlogPage() {
  const [workspace, docs] = await Promise.all([
    getWorkspaceInfo(WORKSPACE_ID),
    getPublishedDocs(WORKSPACE_ID),
  ]);

  if (!workspace) {
    return (
      <div className="public-page-wrapper">
        <div className="blog">
          <p className="public-empty">工作空间不存在或未公开</p>
        </div>
      </div>
    );
  }

  const owner = await getUserInfo(workspace.ownerId);

  return (
    <div className="public-page-wrapper">
      <PublicPageClient workspace={workspace} owner={owner} docs={docs} />
    </div>
  );
}
