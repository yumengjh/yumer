"use client";

import dynamic from "next/dynamic";

const DocImagePreview = dynamic(() => import("@/components/DocImagePreview"), {
  ssr: false,
});

export default function DeferredDocImagePreview() {
  return <DocImagePreview />;
}
