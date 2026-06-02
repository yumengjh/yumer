import type { ReactNode } from "react";

export default function DocLayout({ children }: { children: ReactNode }) {
  return <div className="doc-layout">{children}</div>;
}
