"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FileTextOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, Drawer, Tooltip } from "antd";
import "./styles/document-header.css";

function DocBackIcon() {
  return (
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
  );
}

interface DocumentHeaderProps {
  title: string;
  icon?: ReactNode;
  backHref?: string;
  backControl?: ReactNode;
  backLabel?: string;
  toc?: ReactNode;
  tocLabel?: string;
  tocDrawerTitle?: string;
  onToggleTocDesktop?: () => void;
  desktopBreakpoint?: number;
}

export function DocumentHeader({
  title,
  icon,
  backHref,
  backControl,
  backLabel = "Back",
  toc,
  tocLabel = "Contents",
  tocDrawerTitle = "Contents",
  onToggleTocDesktop,
  desktopBreakpoint = 1024,
}: DocumentHeaderProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= desktopBreakpoint);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [desktopBreakpoint]);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY <= 50) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY) {
        setIsVisible(false);
      } else if (currentScrollY < lastScrollY) {
        setIsVisible(true);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  const hasToc = Boolean(toc || onToggleTocDesktop);

  return (
    <div className={`public-doc-header ${isVisible ? "visible" : "hidden"}`}>
      <div className="public-doc-header-left">
        {backControl ? (
          backControl
        ) : backHref ? (
          <Tooltip title={backLabel} placement="bottom">
            <a href={backHref} className="doc-back-link" aria-label={backLabel}>
              <DocBackIcon />
            </a>
          </Tooltip>
        ) : null}
        <div className="title-display">
          {icon ?? <FileTextOutlined style={{ fontSize: 13, opacity: 0.5 }} />}
          <span>{title || "Untitled"}</span>
        </div>
      </div>
      <div className="public-doc-header-center" />
      <div className="public-doc-header-right">
        {hasToc ? (
          <Tooltip title={tocLabel} placement="bottomRight">
            <Button
              type="text"
              icon={<UnorderedListOutlined />}
              className="mobile-toc-btn"
              onClick={() => {
                if (isMobile && toc) {
                  setDrawerOpen(true);
                  return;
                }
                onToggleTocDesktop?.();
              }}
            />
          </Tooltip>
        ) : null}
      </div>

      <Drawer
        title={tocDrawerTitle}
        placement="right"
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        width={280}
        styles={{ body: { padding: 0 } }}
        className="mobile-toc-drawer"
      >
        {toc}
      </Drawer>
    </div>
  );
}
