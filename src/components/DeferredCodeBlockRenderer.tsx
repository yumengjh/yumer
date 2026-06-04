"use client";

import dynamic from "next/dynamic";

const ClientCodeBlockRenderer = dynamic(
  () => import("@/modules/viewer-kit").then((mod) => mod.CodeBlockEnhancer),
  { ssr: false },
);

export default function DeferredCodeBlockRenderer() {
  return <ClientCodeBlockRenderer />;
}
