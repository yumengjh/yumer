"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileTextOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Drawer, Button, Tooltip } from "antd";
import { PublicDocTOC } from "./PublicDocTOC";
import "./PublicDocHeader.css";

const DOC_LIST_PATH = "/blog";

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

interface PublicDocHeaderProps {
  title: string;
  icon?: string;
  onToggleTocDesktop?: () => void;
}

export function PublicDocHeader({ title, icon, onToggleTocDesktop }: PublicDocHeaderProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    // Only apply dynamic hiding on mobile (width <= 768px)
    // We'll track scroll everywhere, but the CSS will only hide it on mobile
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY <= 50) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY) {
        setIsVisible(false); // scrolling down
      } else if (currentScrollY < lastScrollY) {
        setIsVisible(true); // scrolling up
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  return (
    <div className={`public-doc-header ${isVisible ? "visible" : "hidden"}`}>
      <div className="public-doc-header-left">
        <Tooltip title="返回列表" placement="bottom">
          <Link href={DOC_LIST_PATH} className="doc-back-link" aria-label="返回列表">
            <DocBackIcon />
          </Link>
        </Tooltip>
        <div className="title-display">
          {icon ? <span>{icon}</span> : <FileTextOutlined style={{ fontSize: 13, opacity: 0.5 }} />}
          <span>{title || "无标题"}</span>
        </div>
      </div>
      <div className="public-doc-header-center">
      </div>
      <div className="public-doc-header-right">
        <Tooltip title="目录" placement="bottomRight">
          <Button 
            type="text" 
            icon={<UnorderedListOutlined />} 
            className="mobile-toc-btn"
            onClick={() => {
              if (isMobile) {
                setDrawerOpen(true);
              } else if (onToggleTocDesktop) {
                onToggleTocDesktop();
              }
            }}
          />
        </Tooltip>
      </div>
      
      <Drawer
        title="目录"
        placement="right"
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        width={280}
        styles={{ body: { padding: 0 } }}
        className="mobile-toc-drawer"
      >
        <PublicDocTOC />
      </Drawer>
    </div>
  );
}
