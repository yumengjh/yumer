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
});
