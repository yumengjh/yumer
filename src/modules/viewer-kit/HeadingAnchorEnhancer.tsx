"use client";

import { useEffect } from "react";
import {
  DEFAULT_HEADING_SCROLL_OFFSET,
  enhanceHeadingAnchors,
  scrollToHeadingHash,
} from "./heading-anchor";

interface HeadingAnchorEnhancerProps {
  contentSelector?: string;
  offset?: number;
}

export function HeadingAnchorEnhancer({
  contentSelector,
  offset = DEFAULT_HEADING_SCROLL_OFFSET,
}: HeadingAnchorEnhancerProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      enhanceHeadingAnchors(document, { contentSelector, offset });

      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash) {
        scrollToHeadingHash(hash, offset);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [contentSelector, offset]);

  return null;
}
