"use client";

import dynamic from "next/dynamic";

const ClientCodeBlockRenderer = dynamic(
  () => import("@/components/ClientCodeBlockRenderer"),
  { ssr: false },
);

export default function DeferredCodeBlockRenderer() {
  return <ClientCodeBlockRenderer />;
}
