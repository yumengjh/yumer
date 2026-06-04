"use client";

import dynamic from "next/dynamic";

const DocImagePreview = dynamic(
  () => import("@/modules/viewer-kit").then((mod) => mod.ImagePreview),
  { ssr: false },
);

export default function DeferredDocImagePreview() {
  return <DocImagePreview />;
}
