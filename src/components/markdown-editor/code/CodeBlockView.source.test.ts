import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("CodeBlockView source contract", () => {
  it("uses Ant Design controls and moves secondary settings into the more menu", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/code/CodeBlockView.tsx"),
      "utf8",
    );

    expect(source).toContain('from "antd"');
    expect(source).toContain("MoreOutlined");
    expect(source).toContain("MenuFoldOutlined");
    expect(source).toContain("CopyOutlined");
    expect(source).toContain("code-block-fold-button");
    expect(source).toContain("CheckOutlined");
    expect(source).toContain("codeCopied");
    expect(source).not.toContain("code-block-more-copy");
    expect(source).toContain("popupRender");
    expect(source).not.toContain("<select");
  });

  it("uses a focused centered tab for status bar collapse and restore", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/code/CodeBlockView.tsx"),
      "utf8",
    );

    expect(source).toContain("code-block-status-collapse-tab");
    expect(source).toContain("code-block-status-restore-tab");
    expect(source).toContain("code-block-status-collapse-icon");
    expect(source).toContain("toggleStatusBar");
    expect(source).toContain("keepCodeBlockControlActive");
    expect(source).toContain("onMouseDown={keepCodeBlockControlActive}");
    expect(source).not.toContain("PlayCircleOutlined");
  });

  it("uses click-to-edit title, searchable language select, and hides theme picker", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/code/CodeBlockView.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/styles/editor.css"),
      "utf8",
    );

    expect(source).toContain("code-block-title-display");
    expect(source).toContain("beginTitleEdit");
    expect(source).toContain("showSearch");
    expect(source).not.toContain("code-block-theme-select");
    expect(source).not.toContain("codeBlockThemeItems");
    expect(css).toContain(".code-block-status-collapse-icon");
    expect(css).toContain("max-height 0.24s");
    expect(css).toContain(":not(.code-block-line-content)");
    expect(css).toContain(".doc-content .code-block-view .code-block-line-content");
  });

  it("shows the status tab only while the Tiptap selection is inside the code block", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/code/CodeBlockView.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/styles/editor.css"),
      "utf8",
    );

    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain("is-code-focused");
    expect(css).toContain(".is-code-focused .code-block-status-collapse-tab");
    expect(css).toContain(".is-code-focused .code-block-status-restore-tab");
    expect(css).not.toContain(":focus-within .code-block-status-collapse-tab");
    expect(css).not.toContain(":focus-within .code-block-status-restore-tab");
    expect(css).toContain(".code-block-view.is-status-collapsed .code-block-status-collapse-tab");
    expect(css).not.toContain(".is-selected .code-block-status-collapse-tab");
    expect(css).not.toContain(".is-selected .code-block-status-restore-tab");
  });

  it("uses a stable div content container so line numbers align with the first code line", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/code/CodeBlockView.tsx"),
      "utf8",
    );

    expect(source).toContain('className="code-block-code"');
    expect(source).not.toContain('as={"code" as "div"}');
  });
});
