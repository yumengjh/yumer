"use client";

import { useMemo } from "react";
import Link from "next/link";
import { encodeDocId } from "@/lib/doc-slug";
import type { DocItem, WorkspaceInfo, UserInfo } from "./page";

const DOC_PATH = "/blog";
const DEFAULT_AVATAR =
  "https://gw.alipayobjects.com/zos/rmsportal/BiazfanxmamNRoxxVxka.png";

function formatPostDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if (y === now.getFullYear()) {
    return `${m} 月 ${d} 日`;
  }
  return `${y} 年 ${m} 月 ${d} 日`;
}

function formatMonthLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (y === now.getFullYear()) return `${m} 月`;
  return `${y} 年 ${m} 月`;
}

function groupByMonth(docs: DocItem[]): { label: string; items: DocItem[] }[] {
  const sorted = [...docs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const map = new Map<string, DocItem[]>();
  for (const doc of sorted) {
    const label = formatMonthLabel(doc.updatedAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(doc);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

export default function PublicPageClient({
  workspace,
  owner,
  docs,
}: {
  workspace: WorkspaceInfo;
  owner: UserInfo | null;
  docs: DocItem[];
}) {
  const sections = useMemo(() => groupByMonth(docs), [docs]);
  const authorName = owner?.displayName || owner?.username || null;
  const avatarSrc = owner?.avatar?.trim() || DEFAULT_AVATAR;

  return (
    <div className="blog">
      <header className="blog-hero">
        <p className="blog-hero__eyebrow">知识库</p>
        <h1 className="blog-hero__title">{workspace.name}</h1>
        <div className="blog-hero__meta">
          {owner ? (
            <span className="blog-hero__author">
              <img
                src={avatarSrc}
                alt={authorName || "作者"}
                className="blog-hero__avatar"
                width={22}
                height={22}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== DEFAULT_AVATAR) img.src = DEFAULT_AVATAR;
                }}
              />
              {authorName ? <span>{authorName}</span> : null}
            </span>
          ) : null}
          {owner ? (
            <span className="blog-hero__dot" aria-hidden>
              ·
            </span>
          ) : null}
          {docs.length > 0 ? (
            <span>{docs.length} 篇文章</span>
          ) : (
            <span>暂无文章</span>
          )}
        </div>
      </header>

      <main className="blog-main">
        {docs.length === 0 ? (
          <p className="blog-empty">还没有发布任何文章</p>
        ) : (
          sections.map((section) => (
            <section key={section.label} className="blog-section">
              <h2 className="blog-section__label">{section.label}</h2>
              <ul className="blog-list">
                {section.items.map((doc) => (
                  <li key={doc.docId} className="blog-post">
                    <Link
                      href={`${DOC_PATH}/${encodeDocId(doc.docId)}`}
                      className="blog-post__link"
                    >
                      <span className="blog-post__title">
                        {doc.icon ? (
                          <span className="blog-post__emoji" aria-hidden>
                            {doc.icon}
                          </span>
                        ) : null}
                        {doc.title || "无标题"}
                      </span>
                      <span className="blog-post__meta">
                        <time dateTime={doc.updatedAt}>
                          {formatPostDate(doc.updatedAt)}
                        </time>
                        {doc.publishedHead ? (
                          <span className="blog-post__badge">已发布</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      <footer className="blog-footer">
        {(workspace.icon || workspace.description) && (
          <div className="blog-footer__about">
            {workspace.icon ? (
              <span className="blog-footer__icon" aria-hidden>
                {workspace.icon}
              </span>
            ) : null}
            {workspace.description ? (
              <p className="blog-footer__desc">{workspace.description}</p>
            ) : null}
          </div>
        )}
        <p className="blog-footer__credit">Powered by Yuediter</p>
      </footer>
    </div>
  );
}
