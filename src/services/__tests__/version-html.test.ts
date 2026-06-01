import { describe, expect, it } from "vitest";
import { versionTreeToHtml, annotateBlockChanges } from "../version-html";
import type { Block, DiffChange } from "../document";

function block(input: Partial<Block> & Pick<Block, "blockId" | "type" | "payload">): Block {
  return {
    docId: "doc_1",
    sortKey: "001000",
    indent: 0,
    collapsed: false,
    ...input,
  };
}

describe("version html rendering", () => {
  it("uses the shared code block placeholder renderer and keeps block ids", () => {
    const tree = block({
      blockId: "root",
      type: "root",
      payload: {},
      children: [
        block({
          blockId: "code_1",
          type: "codeBlock",
          payload: {
            type: "codeBlock",
            attrs: { language: "typescript", title: "Example" },
            content: [{ type: "text", text: "const answer = 42;" }],
          },
        }),
      ],
    });

    const html = versionTreeToHtml(tree);

    expect(html).toContain('class="code-block-view code-block-placeholder"');
    expect(html).toContain('data-code-block-placeholder="true"');
    expect(html).toContain('data-block-id="code_1"');
    expect(html).toContain('data-title="Example"');
    expect(html).not.toContain("<pre><code>const answer = 42;</code></pre>");
  });

  it("adds diff classes to rendered editor blocks", () => {
    const html = '<p data-block-id="p_1">Hello</p>';
    const changes: DiffChange[] = [{ type: "modified", blockId: "p_1" }];

    expect(annotateBlockChanges(html, changes)).toBe(
      '<p data-block-id="p_1" class="diff-block-modified">Hello</p>',
    );
  });
});
