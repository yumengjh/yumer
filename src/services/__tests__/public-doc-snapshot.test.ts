import { describe, expect, it } from "vitest";
import {
  resolvePublicDocHtml,
  sanitizePublicDocHtml,
} from "../public-doc-snapshot";

describe("public doc snapshot helpers", () => {
  it("prefers backend-rendered html when available", () => {
    const html = resolvePublicDocHtml({
      title: "Doc",
      html: '<h2 id="qEmdXB">用户类型与应用端划分</h2>',
      tree: {
        blockId: "root_1",
        type: "root",
        payload: {},
        children: [],
      },
    });

    expect(html).toContain('id="qEmdXB"');
    expect(html).not.toContain("heading-0");
  });

  it("preserves heading ids and data-anchor during sanitization", () => {
    const html = sanitizePublicDocHtml(
      '<h2 id="qEmdXB" data-anchor="qEmdXB" data-client-id="cid_1">Title</h2>',
    );

    expect(html).toContain('id="qEmdXB"');
    expect(html).toContain('data-anchor="qEmdXB"');
    expect(html).toContain('data-client-id="cid_1"');
  });
});
