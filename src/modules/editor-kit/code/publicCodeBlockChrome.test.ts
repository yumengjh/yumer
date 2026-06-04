import { describe, expect, it } from "vitest";
import {
  getCodeLanguageLabel,
  renderPublicCodeBlockChrome,
} from "./publicCodeBlockChrome";
import { CODE_BLOCK_DEFAULTS } from "./codeBlockOptions";

describe("publicCodeBlockChrome", () => {
  it("maps language keys to display labels", () => {
    expect(getCodeLanguageLabel("javascript")).toBe("JavaScript");
    expect(getCodeLanguageLabel("typescript")).toBe("TypeScript");
  });

  it("renders fold, title, language, and copy controls", () => {
    const html = renderPublicCodeBlockChrome({
      ...CODE_BLOCK_DEFAULTS,
      title: "demo",
      language: "javascript",
    });

    expect(html).toContain("code-block-public-fold");
    expect(html).toContain("demo");
    expect(html).toContain("JavaScript");
    expect(html).toContain("code-block-public-copy");
    expect(html).toContain("复制代码");
    expect(html).toContain("code-block-public-icon-check");
  });

  it("uses placeholder styling when title is empty", () => {
    const html = renderPublicCodeBlockChrome({
      ...CODE_BLOCK_DEFAULTS,
      title: "",
      language: "javascript",
    });

    expect(html).toContain("is-placeholder");
    expect(html).toContain("未命名代码块");
  });

  it("renders only a floating copy button when the status bar is collapsed", () => {
    const html = renderPublicCodeBlockChrome({
      ...CODE_BLOCK_DEFAULTS,
      statusBarCollapsed: true,
    });

    expect(html).toContain("code-block-public-chrome--minimal");
    expect(html).toContain("code-block-public-copy--floating");
    expect(html).not.toContain("code-block-status-bar");
    expect(html).not.toContain("code-block-public-fold");
  });
});
