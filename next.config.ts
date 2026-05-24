import type { NextConfig } from "next";

// ── 构建时调试日志 ──
console.log("━━━ next.config.ts 构建环境变量 ━━━");
console.log("  process.env.NEXT_PUBLIC_DOC_PATH =", JSON.stringify(process.env.NEXT_PUBLIC_DOC_PATH));
console.log("  NODE_ENV =", JSON.stringify(process.env.NODE_ENV));
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// 文档详情页公开路径，硬编码为 /blog
// 如需修改请改这里 + PublicPageClient.tsx 中的 DOC_PATH
const DOC_PATH = "/blog";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: `${DOC_PATH}/:slug/latest`,
        destination: `/doc/:slug?latest=1`,
      },
      {
        source: `${DOC_PATH}/:slug`,
        destination: `/doc/:slug`,
      },
    ];
  },
};

export default nextConfig;
