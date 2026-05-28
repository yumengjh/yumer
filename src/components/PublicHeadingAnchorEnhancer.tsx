"use client";

import { useEffect } from "react";
import {
  enhancePublicHeadingAnchors,
  scrollToPublicHeadingHash,
} from "./public-heading-anchor";

export function PublicHeadingAnchorEnhancer() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      enhancePublicHeadingAnchors(document);

      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash) {
        scrollToPublicHeadingHash(hash);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
