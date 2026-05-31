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

  it("preserves custom task checkbox svg during sanitization", () => {
    const html = sanitizePublicDocHtml(
      [
        '<ul data-type="taskList">',
        '<li data-type="taskItem" data-list-font-size="22px" style="--list-font-size:22px;--task-checkbox-size:23.47px;--task-check-stroke:5.87px">',
        '<div class="checkbox-wrapper">',
        '<input type="checkbox" checked="checked" class="check task-item-checkbox-input" />',
        '<label class="label task-item-checkbox">',
        '<svg class="task-item-checkbox-svg" viewBox="0 0 95 95" aria-hidden="true">',
        '<rect x="30" y="20" width="50" height="50" fill="none" class="task-item-checkbox-box"></rect>',
        '<g transform="translate(0,-952.36222)">',
        '<path d="m 56,963 c -102,122 6,9 7,9" fill="none" class="path1 task-item-check-path"></path>',
        "</g>",
        "</svg>",
        "</label>",
        "</div>",
        "<div><p>todo</p></div>",
        "</li>",
        "</ul>",
      ].join(""),
    );

    expect(html).toContain('class="checkbox-wrapper"');
    expect(html).toContain('class="check task-item-checkbox-input"');
    expect(html).toContain('class="label task-item-checkbox"');
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 95 95"');
    expect(html).toContain("<rect");
    expect(html).toContain("<path");
    expect(html).toContain("--task-checkbox-size:23.47px");
  });
});
