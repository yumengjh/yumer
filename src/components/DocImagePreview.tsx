"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "antd";

const CONTENT_SELECTOR = ".doc-content";

function isPreviewableImage(img: HTMLImageElement): boolean {
  if (!img.src || img.closest("[data-code-block-placeholder]")) return false;
  return true;
}

function collectPreviewItems(container: Element): { src: string; alt?: string }[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>("img"))
    .filter(isPreviewableImage)
    .map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt || undefined,
    }));
}

export default function DocImagePreview() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewItems, setPreviewItems] = useState<{ src: string; alt?: string }[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  const bindImages = useCallback(() => {
    cleanupRef.current?.();

    const container = document.querySelector(CONTENT_SELECTOR);
    if (!container) return;

    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img")).filter(
      isPreviewableImage,
    );
    const items = collectPreviewItems(container);
    const disposers: Array<() => void> = [];

    images.forEach((img, index) => {
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setPreviewItems(items);
        setPreviewIndex(index);
        setPreviewOpen(true);
      };

      img.addEventListener("click", onClick);
      disposers.push(() => img.removeEventListener("click", onClick));
    });

    cleanupRef.current = () => {
      disposers.forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    bindImages();
    return () => cleanupRef.current?.();
  }, [bindImages]);

  return (
    <Image.PreviewGroup
      items={previewItems}
      preview={{
        open: previewOpen,
        current: previewIndex,
        onOpenChange: (open, info) => {
          setPreviewOpen(open);
          setPreviewIndex(info.current);
        },
        onChange: (current) => setPreviewIndex(current),
      }}
    />
  );
}
