"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DocumentHeader } from "./DocumentHeader";
import "./styles/document-layout.css";

interface DocumentLayoutProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
  backHref?: string;
  backControl?: ReactNode;
  backLabel?: string;
  tocLabel?: string;
  tocDrawerTitle?: string;
  defaultTocOpen?: boolean;
  tocStorageKey?: string;
  contentWidth?: number;
  fontSize?: number;
}

export function DocumentLayout({
  title,
  icon,
  children,
  sidebar,
  footer,
  backHref,
  backControl,
  backLabel = "Back",
  tocLabel = "Contents",
  tocDrawerTitle = "Contents",
  defaultTocOpen = false,
  tocStorageKey,
  contentWidth = 800,
  fontSize = 16,
}: DocumentLayoutProps) {
  const [tocOpen, setTocOpen] = useState(defaultTocOpen);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (tocStorageKey) {
      const saved = window.localStorage.getItem(tocStorageKey);
      if (saved === "true") {
        setTocOpen(true);
      } else if (saved === "false") {
        setTocOpen(false);
      }
    }

    const checkMobile = () => setIsMobile(window.innerWidth <= 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [tocStorageKey]);

  const layoutStyle = {
    "--doc-content-width": `${contentWidth}px`,
    "--doc-font-size": `${fontSize}px`,
  } as CSSProperties;

  const handleToggleTocDesktop = () => {
    const next = !tocOpen;
    setTocOpen(next);
    if (tocStorageKey) {
      window.localStorage.setItem(tocStorageKey, String(next));
    }
  };

  return (
    <div className="doc-page" style={layoutStyle}>
      <DocumentHeader
        title={title}
        icon={icon}
        backHref={backHref}
        backControl={backControl}
        backLabel={backLabel}
        toc={sidebar}
        tocLabel={tocLabel}
        tocDrawerTitle={tocDrawerTitle}
        onToggleTocDesktop={sidebar ? handleToggleTocDesktop : undefined}
      />
      <div className="doc-page-body">
        <main className="doc-main-content">{children}</main>
        {!isMobile && tocOpen && sidebar ? (
          <div className="doc-sidebar-container">
            <aside className="doc-sidebar">{sidebar}</aside>
          </div>
        ) : null}
      </div>
      {footer}
    </div>
  );
}
