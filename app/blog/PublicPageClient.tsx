"use client";

import { useMemo } from "react";
import Link from "next/link";
import { encodeDocId } from "@/lib/doc-slug";
import type { DocItem, WorkspaceInfo, UserInfo } from "./page";

const DOC_PATH = "/blog";

function formatPostDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return sameYear ? `${month}/${day}` : `${date.getFullYear()}/${month}/${day}`;
}

function formatMonthLabel(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function groupByMonth(docs: DocItem[]): { label: string; items: DocItem[] }[] {
  const sorted = [...docs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const groups = new Map<string, DocItem[]>();

  for (const doc of sorted) {
    const label = formatMonthLabel(doc.updatedAt);
    const items = groups.get(label) ?? [];
    items.push(doc);
    groups.set(label, items);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
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
  const authorName = owner?.displayName || owner?.username || "未命名";

  return (
    <div className="blog">
      <main className="blog-main">
        {docs.length === 0 ? (
          <p className="blog-empty">空</p>
        ) : (
          sections.map((section) => (
            <section key={section.label} className="blog-section">
              <h2 className="blog-section__label">{section.label}</h2>
              <ul className="blog-list">
                {section.items.map((doc) => (
                  <li key={doc.docId} className="blog-post">
                    <Link href={`${DOC_PATH}/${encodeDocId(doc.docId)}`} className="blog-post__link">
                      <span className="blog-post__title">{doc.title || "无标题"}</span>
                      <time className="blog-post__meta" dateTime={doc.updatedAt}>
                        {formatPostDate(doc.updatedAt)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      <footer className="blog-footer">
        <div className="blog-footer__group">
          <div className="blog-footer__row">
            <span className="blog-footer__key">站点</span>
            <span className="blog-footer__value">{workspace.name}</span>
          </div>
          {workspace.description ? (
            <div className="blog-footer__desc">{workspace.description}</div>
          ) : null}
        </div>

        <div className="blog-footer__group">
          <div className="blog-footer__row">
            <span className="blog-footer__key">作者</span>
            <span className="blog-footer__value">
              {owner?.avatar ? (
                <img className="blog-footer__avatar" src={owner.avatar} alt="" />
              ) : null}
              <span>{authorName}</span>
            </span>
          </div>
          <div className="blog-footer__row">
            <span className="blog-footer__key">概览</span>
            <span className="blog-footer__value">{docs.length} 篇文章</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
