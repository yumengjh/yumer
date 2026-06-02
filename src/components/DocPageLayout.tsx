"use client";

import { useState, useEffect, ReactNode, type CSSProperties } from "react";
import { PublicDocHeader } from "./PublicDocHeader";
import {
  buildSettingsState,
  getClientVisibleSettings,
  type SettingsState,
} from "@/services/settings";

interface DocPageLayoutProps {
  title: string;
  icon?: string;
  children: ReactNode;
  sidebar: ReactNode;
  footer?: ReactNode;
  workspaceId?: string;
}

export function DocPageLayout({ title, icon, children, sidebar, footer, workspaceId }: DocPageLayoutProps) {
  const [tocOpen, setTocOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    buildSettingsState({ priority: "workspace-first" }),
  );

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

  useEffect(() => {
    let active = true;

    const runWhenIdle = () => {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => {
          void getClientVisibleSettings(workspaceId)
            .then((nextState) => {
              if (active) {
                setSettingsState(nextState);
              }
            })
            .catch((error) => {
              console.log("[public-doc] settings request failed", error);
              if (active) {
                setSettingsState(buildSettingsState({ priority: "workspace-first" }));
              }
            });
        });
        return;
      }

      globalThis.setTimeout(() => {
        void getClientVisibleSettings(workspaceId)
          .then((nextState) => {
            if (active) {
              setSettingsState(nextState);
            }
          })
          .catch((error) => {
            console.log("[public-doc] settings request failed", error);
            if (active) {
              setSettingsState(buildSettingsState({ priority: "workspace-first" }));
            }
          });
      }, 0);
    };

    const start = () => {
      if (!active) return;
      runWhenIdle();
    };

    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }

    return () => {
      active = false;
      window.removeEventListener("load", start);
    };
  }, [workspaceId]);

  const layoutStyle = {
    "--doc-content-width": `${settingsState.effectiveSettings.reader.contentWidth}px`,
    "--doc-font-size": `${settingsState.effectiveSettings.reader.fontSize}px`,
  } as CSSProperties;

  const handleToggleTocDesktop = () => {
    const next = !tocOpen;
    setTocOpen(next);
    localStorage.setItem("yuediter_doc_toc_open", String(next));
  };

  return (
    <div className="doc-page" style={layoutStyle}>
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
      {footer}
    </div>
  );
}
