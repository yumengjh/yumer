"use client";

import { useState, useEffect, ReactNode } from "react";
import { PublicDocHeader } from "./PublicDocHeader";

interface DocPageLayoutProps {
  title: string;
  icon?: string;
  children: ReactNode;
  sidebar: ReactNode;
}

export function DocPageLayout({ title, icon, children, sidebar }: DocPageLayoutProps) {
  const [tocOpen, setTocOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("yuediter_doc_toc_open");
    // 默认关闭
    if (saved === "true") {
      setTocOpen(true);
    }

    const checkMobile = () => setIsMobile(window.innerWidth <= 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleToggleTocDesktop = () => {
    const next = !tocOpen;
    setTocOpen(next);
    localStorage.setItem("yuediter_doc_toc_open", String(next));
  };

  return (
    <div className="doc-page">
      <PublicDocHeader 
        title={title} 
        icon={icon} 
        onToggleTocDesktop={handleToggleTocDesktop} 
      />
      <div className="doc-page-body">
        <main className="doc-main-content">
          {children}
        </main>
        {(!isMobile && tocOpen) && (
          <div className="doc-sidebar-container">
            <aside className="doc-sidebar">
              {sidebar}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
