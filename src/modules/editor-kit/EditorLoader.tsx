interface EditorLoaderProps {
  label?: string;
  variant?: "screen" | "inline";
}

export default function EditorLoader({
  label = "Loading editor",
  variant = "screen",
}: EditorLoaderProps) {
  const minHeight = variant === "inline" ? 240 : "100vh";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        color: "var(--app-text-secondary, #6b7280)",
        fontSize: "14px",
        letterSpacing: "0.02em",
      }}
    >
      <span>{label}</span>
    </div>
  );
}
