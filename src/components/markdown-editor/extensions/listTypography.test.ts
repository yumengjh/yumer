// @vitest-environment jsdom

import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { findListContentFontSize, getListTypographyVars } from "./listTypography";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
    listItem: { group: "block", content: "paragraph+" },
    taskItem: { group: "block", content: "paragraph+" },
  },
  marks: {
    textStyle: {
      attrs: { fontSize: { default: null } },
    },
  },
});

describe("listTypography", () => {
  it("reads font size from the first textStyle mark inside a list item", () => {
    const node = schema.node("listItem", null, [
      schema.node("paragraph", null, [
        schema.text("待办", [schema.mark("textStyle", { fontSize: "22" })]),
      ]),
    ]);

    expect(findListContentFontSize(node)).toBe("22px");
  });

  it("returns css vars for scaled list markers and task checkboxes", () => {
    const node = schema.node("taskItem", null, [
      schema.node("paragraph", null, [
        schema.text("放大文字", [schema.mark("textStyle", { fontSize: "24" })]),
      ]),
    ]);

    expect(getListTypographyVars(node)).toEqual({
      "--list-font-size": "24px",
      "--task-checkbox-size": "25.6px",
      "--task-checkbox-offset": "41.76px",
      "--task-checkbox-gap": "19.2px",
      "--task-checkmark-width": "6.4px",
      "--task-checkmark-height": "12.8px",
      "--task-checkmark-left": "7.2px",
      "--task-checkmark-top": "1.6px",
      "--task-checkmark-border": "3.2px",
      "--task-checkbox-radius": "9.6px",
      "--task-check-stroke": "6.4px",
      "--task-check-length": "160",
    });
  });

  it("returns null when the list content has no explicit font size", () => {
    const node = schema.node("listItem", null, [
      schema.node("paragraph", null, [schema.text("默认字号")]),
    ]);

    expect(getListTypographyVars(node)).toBeNull();
  });
});
