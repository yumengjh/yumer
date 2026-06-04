"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DocumentLayout } from "@/modules/viewer-kit";
import {
  buildSettingsState,
  getClientVisibleSettings,
  type SettingsState,
} from "@/services/settings";

interface DocPageLayoutProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  sidebar: React.ReactNode;
  footer?: React.ReactNode;
  workspaceId?: string;
}

export function DocPageLayout({
  title,
  icon,
  children,
  sidebar,
  footer,
  workspaceId,
}: DocPageLayoutProps) {
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    buildSettingsState({ priority: "workspace-first" }),
  );

  useEffect(() => {
    let active = true;

    const applyFallback = () => {
      if (active) {
        setSettingsState(buildSettingsState({ priority: "workspace-first" }));
      }
    };

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
              applyFallback();
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
            applyFallback();
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

  return (
    <DocumentLayout
      title={title}
      icon={icon ? <span>{icon}</span> : undefined}
      sidebar={sidebar}
      footer={footer}
      backControl={
        <Link href="/blog" className="doc-back-link" aria-label="返回列表">
          <svg
            className="doc-back-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <path
              d="M19 12H5M5 12L12 19M5 12L12 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      }
      backLabel="返回列表"
      tocLabel="目录"
      tocDrawerTitle="目录"
      tocStorageKey="yuediter_doc_toc_open"
      contentWidth={settingsState.effectiveSettings.reader.contentWidth}
      fontSize={settingsState.effectiveSettings.reader.fontSize}
    >
      {children}
    </DocumentLayout>
  );
}
