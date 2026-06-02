import Link from "next/link";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { TagSummary } from "@/services/public-doc-snapshot";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api-zzz.yumgjs.com/api/v1";
const DOC_LIST_PATH = "/blog";
const WORKSPACE_REVALIDATE_SECONDS = 3600;

// TODO: 后续改为从配置/环境变量读取
const SITE_CONFIG = {
  email: "hi@yumg.cn",
  github: "https://github.com/yumengjh",
  githubLabel: "GitHub",
  icp: "",
  links: [
    {label:'数字空间',href:'https://yumgjs.com'},
    {label:'知识库',href:'https://blog.yumgjs.com'}
  ] as { label: string; href: string }[],
};

interface DocFooterProps {
  authorName: string;
  authorAvatar?: string | null;
  category?: string;
  updatedAt?: string;
  viewCount: number;
  tags: TagSummary[];
  workspaceId?: string;
}

interface WorkspaceInfo {
  name: string;
  description?: string;
}

async function readWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
      next: {
        revalidate: WORKSPACE_REVALIDATE_SECONDS,
        tags: [`workspace:${workspaceId}`],
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success) return null;
    return { name: json.data.name, description: json.data.description };
  } catch {
    return null;
  }
}

const getCachedWorkspaceInfo = unstable_cache(
  readWorkspaceInfo,
  ["workspace-info"],
  { revalidate: WORKSPACE_REVALIDATE_SECONDS },
);

const getWorkspaceInfo = cache((workspaceId: string) =>
  getCachedWorkspaceInfo(workspaceId),
);

function formatDate(dateString?: string) {
  if (!dateString) return "";
  return new Date(dateString)
    .toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\//g, "-");
}

export async function DocFooter({
  authorName,
  authorAvatar,
  category,
  updatedAt,
  viewCount,
  tags,
  workspaceId,
}: DocFooterProps) {
  const workspace = workspaceId ? await getWorkspaceInfo(workspaceId) : null;
  const siteName = workspace?.name || "";
  const year = new Date().getFullYear();

  return (
    <footer className="doc-footer">
      <div className="doc-footer-inner">
        {/* 文档元数据：作者 / 分类 / 更新 / 浏览 / 标签 */}
        <div className="doc-footer-meta">
          <span className="doc-meta-entry">
            <span className="doc-meta-label">作者</span>
            <span className="doc-meta-value">
              {authorAvatar ? (
                <img className="doc-meta-avatar" src={authorAvatar} alt="" />
              ) : null}
              {authorName}
            </span>
          </span>
          {category && (
            <span className="doc-meta-entry">
              <span className="doc-meta-label">分类</span>
              <span className="doc-meta-value">{category}</span>
            </span>
          )}
          {updatedAt && (
            <span className="doc-meta-entry">
              <span className="doc-meta-label">更新</span>
              <time className="doc-meta-value" dateTime={updatedAt}>
                {formatDate(updatedAt)}
              </time>
            </span>
          )}
          <span className="doc-meta-entry">
            <span className="doc-meta-label">浏览</span>
            <span className="doc-meta-value">{viewCount}</span>
          </span>
        </div>

        {tags.length > 0 && (
          <div className="doc-tags-list">
            {tags.map((tag) => (
              <span key={tag.tagId} className="doc-tag-badge">
                <span
                  className="doc-tag-dot"
                  style={{ backgroundColor: tag.color || "#ccc" }}
                />
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* 站点信息：名称 · 描述 | 邮箱 · GitHub · 链接 */}
        <div className="doc-footer-site">
          <div className="doc-footer-site-main">
            {siteName && <span className="doc-footer-site-name">{siteName}</span>}
            {workspace?.description && (
              <span className="doc-footer-site-desc">{workspace.description}</span>
            )}
          </div>
          <nav className="doc-footer-links" aria-label="页脚链接">
            {SITE_CONFIG.email && (
              <a href={`mailto:${SITE_CONFIG.email}`} className="doc-footer-link">
                {SITE_CONFIG.email}
              </a>
            )}
            {SITE_CONFIG.github && (
              <a
                href={SITE_CONFIG.github}
                className="doc-footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {SITE_CONFIG.githubLabel}
              </a>
            )}
            {SITE_CONFIG.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="doc-footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            ))}
            <Link href={DOC_LIST_PATH} className="doc-footer-link">
              返回列表
            </Link>
          </nav>
        </div>

        {/* 版权区：© 年份 · 站点名 | 备案号 */}
        <div className="doc-footer-copyright">
          <span>
            © {year} {siteName} 保留所有权利。
          </span>
          {SITE_CONFIG.icp && <span className="doc-footer-icp">{SITE_CONFIG.icp}</span>}
        </div>
      </div>
    </footer>
  );
}
