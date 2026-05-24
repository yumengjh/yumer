"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.log("[app/error]", error);
  }, [error]);

  return (
    <main
      style={{
        margin: 0,
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#fff",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "720px",
          padding: "40px 32px",
          border: "1px solid #f0f0f0",
          borderRadius: "16px",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#ef4444" }}>
          页面加载异常
        </div>
        <h1 style={{ margin: "12px 0 8px", fontSize: "28px", color: "#111827" }}>
          抱歉，页面发生错误
        </h1>
        <p style={{ margin: "0 0 12px", color: "#6b7280", lineHeight: 1.7 }}>
          下面是当前错误信息：
        </p>
        <pre
          style={{
            margin: "0 0 24px",
            padding: "16px",
            borderRadius: "12px",
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            color: "#111827",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: "40px",
            padding: "0 16px",
            borderRadius: "999px",
            border: 0,
            background: "#111827",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </section>
    </main>
  );
}
