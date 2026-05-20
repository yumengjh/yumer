"use client";

import { useEffect, useState } from "react";
import { FileTextOutlined } from "@ant-design/icons";
import "./PublicDocHeader.css";

interface PublicDocHeaderProps {
  title: string;
  icon?: string;
}

export function PublicDocHeader({ title, icon }: PublicDocHeaderProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

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
        {/* 预留左侧区域 */}
      </div>
      <div className="public-doc-header-center">
        <div className="title-display">
          {icon ? <span>{icon}</span> : <FileTextOutlined style={{ fontSize: 13, opacity: 0.5 }} />}
          <span>{title || "无标题"}</span>
        </div>
      </div>
      <div className="public-doc-header-right">
        {/* 预留右侧区域 */}
      </div>
    </div>
  );
}
