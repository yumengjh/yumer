import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("TaskItemView source contract", () => {
  it("uses a custom svg checkbox with list typography vars", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/TaskItemView.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/styles/editor.css"),
      "utf8",
    );
    const publicDocCss = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/style.css"),
      "utf8",
    );

    expect(source).toContain("getListTypographyVars");
    expect(source).toContain("style={styleVars}");
    expect(source).not.toContain('from "antd"');
    expect(source).toContain('className="checkbox-wrapper"');
    expect(source).toContain('className="check task-item-checkbox-input"');
    expect(source).toContain('className="label task-item-checkbox"');
    expect(source).toContain("<svg");
    expect(source).toContain('className="path1 task-item-check-path"');
    expect(source).toContain('transform="translate(0,-952.36222)"');
    expect(source).toContain('d="m 56,963 c -102,122 6,9 7,9 17,-5 -66,69 -38,52 122,-77 -7,14 18,4 29,-11 45,-43 23,-4"');
    expect(source).toContain('type="checkbox"');
    expect(css).toContain("li[data-list-font-size]::marker");
    expect(css).toContain("--task-checkbox-size");
    expect(css).toContain(".checkbox-wrapper .check");
    expect(css).toContain(".checkbox-wrapper .path1");
    expect(css).toContain(".checkbox-wrapper .check:checked + .label svg g path");
    expect(css).toContain(".doc-content .task-item-checkbox-input:checked + .task-item-checkbox svg g path");
    expect(css).toContain(".task-item-checkbox-input");
    expect(css).toContain(".task-item-checkbox-svg");
    expect(css).toContain('input[type="checkbox"]:not(.ant-checkbox-input):not(.task-item-checkbox-input)');
    expect(css).toContain("stroke-dashoffset");
    expect(css).toContain("margin-top: calc((var(--list-font-size, 15px) * 1.74 - var(--task-checkbox-size)) / 2)");
    expect(publicDocCss).toContain(".doc-content .task-item-checkbox-svg");
    expect(publicDocCss).toContain(".doc-content .checkbox-wrapper .check:checked + .label svg g path");
    expect(publicDocCss).toContain('> div:not(.checkbox-wrapper)');
    expect(publicDocCss).toContain('input[type="checkbox"]:not(.task-item-checkbox-input)');
    expect(publicDocCss).toContain("margin-top: calc((var(--list-font-size, 15px) * 1.74 - var(--task-checkbox-size)) / 2)");
  });
});
