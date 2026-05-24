import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderBlockTreeToHtml } from "../generate-block-html";

describe("doc page SSR rendering contract", () => {
  it("server page should not depend on jsdom-based runtime sanitizers/renderers", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).not.toContain('from "isomorphic-dompurify"');
  });

  it("server page should request mixed html/json content from the backend", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("/content?mode=all");
  });

  it("metadata generation should not warm the html render cache", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );
    const metadataSource = pageSource.slice(
      pageSource.indexOf("export async function generateMetadata"),
      pageSource.indexOf("export default async function DocPage"),
    );

    expect(metadataSource).not.toContain("/content?mode=all");
    expect(metadataSource).toContain("getDocMetadata");
  });

  it("server page delegates code highlighting to the browser", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).not.toContain("highlightCodeBlocks");
    expect(pageSource).toContain("ClientCodeBlockRenderer");
  });

  it("renders common block payloads into html fragments", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "p1",
          type: "paragraph",
          sortKey: "001000",
          payload: {
            type: "paragraph",
            attrs: { textAlign: null, lineHeight: null, indent: 0 },
            content: [{ type: "text", text: "Hello SSR" }],
          },
          children: [],
        },
        {
          blockId: "l1",
          type: "bulletList",
          sortKey: "002000",
          payload: {
            type: "bulletList",
            attrs: {},
            content: [
              {
                type: "listItem",
                attrs: {},
                content: [
                  {
                    type: "paragraph",
                    attrs: { textAlign: null, lineHeight: null, indent: 0 },
                    content: [{ type: "text", text: "Item one" }],
                  },
                ],
              },
            ],
          },
          children: [],
        },
        {
          blockId: "h1",
          type: "highlightBlock",
          sortKey: "003000",
          payload: {
            type: "highlightBlock",
            attrs: { backgroundColor: "#FFF2CC" },
            content: [
              {
                type: "paragraph",
                attrs: { textAlign: null, lineHeight: null, indent: 0 },
                content: [{ type: "text", text: "Highlighted" }],
              },
            ],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain("<p>Hello SSR</p>");
    expect(html).toContain("<ul");
    expect(html).toContain("Item one");
    expect(html).toContain('data-highlight-block=""');
    expect(html).toContain("Highlighted");
  });

  it("prefers backend block html and falls back to local json rendering per block", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "p1",
          type: "paragraph",
          sortKey: "001000",
          html: '<p data-server-rendered="true">Rendered by backend</p>',
          payload: {
            type: "paragraph",
            content: [{ type: "text", text: "Should not render this JSON" }],
          },
          children: [],
        },
        {
          blockId: "h1",
          type: "heading",
          sortKey: "002000",
          payload: {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Rendered from JSON fallback" }],
          },
          children: [],
        },
        {
          blockId: "code1",
          type: "codeBlock",
          sortKey: "003000",
          payload: {
            type: "codeBlock",
            attrs: { language: "ts" },
            content: [{ type: "text", text: "const answer = 42;" }],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain("Rendered by backend");
    expect(html).not.toContain("Should not render this JSON");
    expect(html).toContain("<h2>Rendered from JSON fallback</h2>");
    expect(html).toContain('data-code-block-placeholder="true"');
    expect(html).toContain('data-language="typescript"');
    expect(html).toContain("const answer = 42;");
  });

  it("emits placeholders for code blocks even when backend html is present", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "code1",
          type: "codeBlock",
          sortKey: "001000",
          html: "<pre><code>server highlighted</code></pre>",
          payload: {
            type: "codeBlock",
            attrs: { language: "javascript", title: "Demo" },
            content: [{ type: "text", text: "console.log(1);" }],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('data-code-block-placeholder="true"');
    expect(html).toContain('data-title="Demo"');
    expect(html).toContain("console.log(1);");
    expect(html).not.toContain("server highlighted");
  });

  it("keeps public code block placeholders visually empty before client highlighting", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "code1",
          type: "codeBlock",
          sortKey: "001000",
          payload: {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: "console.log(1);" }],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('data-code-block-code="console.log(1);"');
    expect(html).not.toContain("<pre><code>console.log(1);</code></pre>");
  });

  it("does not render public code block title or language when the status bar is collapsed", () => {
    const rendererSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/ClientCodeBlockRenderer.tsx"),
      "utf8",
    );

    expect(rendererSource).toContain("if (attrs.statusBarCollapsed) {\n    return \"\";");
    expect(rendererSource).not.toContain("class=\"code-block-status-restore\"");
  });
});
