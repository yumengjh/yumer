"use client";

import dynamic from "next/dynamic";
import AppLoader from "@/components/AppLoader";

const EditorPage = dynamic(() => import("@/components/EditorPage"), {
  ssr: false,
  loading: () => (
    <AppLoader
      label="正在打开编辑器…"
      words={["加载资源", "打开编辑器", "准备界面", "恢复会话", "加载资源"]}
    />
  ),
});

export default function DashPage() {
  return <EditorPage />;
}
