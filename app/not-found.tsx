import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#fff",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          padding: "40px 32px",
          border: "1px solid #f0f0f0",
          borderRadius: "16px",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.06)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "48px", fontWeight: 700, color: "#111827" }}>404</div>
        <h1 style={{ margin: "12px 0 8px", fontSize: "28px", color: "#111827" }}>
          文档不存在
        </h1>
        <p style={{ margin: "0 0 24px", color: "#6b7280", lineHeight: 1.7 }}>
          你访问的内容可能已删除、未发布，或链接地址不正确。
        </p>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "132px",
            height: "40px",
            padding: "0 16px",
            borderRadius: "999px",
            background: "#111827",
            color: "#fff",
            textDecoration: "none",
          }}
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
