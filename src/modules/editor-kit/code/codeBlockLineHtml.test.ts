import { describe, expect, it } from "vitest";
import {
  countCodeLines,
  renderCodeBlockBodyHtml,
  splitCodeLines,
  tokenLineToHtml,
} from "./codeBlockLineHtml";

describe("codeBlockLineHtml", () => {
  it("splits code into lines including a trailing newline", () => {
    expect(splitCodeLines("a\nb\n")).toEqual(["a", "b", ""]);
    expect(countCodeLines("a\nb\n")).toBe(3);
  });

  it("renders per-line rows when line numbers are enabled", () => {
    const html = renderCodeBlockBodyHtml({
      code: "a\nb",
      lineNumbers: true,
      lineContents: ["<span>x</span>", "y"],
    });

    expect(html).toContain("has-line-numbers");
    expect(html).toContain('class="code-block-line"');
    expect(html).toContain("<span>x</span>");
    expect(html).toMatch(/code-block-line-number[^>]*>1</);
    expect(html).toMatch(/code-block-line-number[^>]*>2</);
  });

  it("adds horizontal padding when line numbers are disabled", () => {
    const html = renderCodeBlockBodyHtml({
      code: "hello",
      lineNumbers: false,
    });

    expect(html).not.toContain("has-line-numbers");
    expect(html).toContain('class="code-block-content"');
    expect(html).toContain("hello");
  });

  it("escapes plain text tokens per line", () => {
    const html = tokenLineToHtml([
      { content: "<tag>", offset: 0, color: "#fff" } as never,
    ]);
    expect(html).toContain("&lt;tag&gt;");
  });
});
