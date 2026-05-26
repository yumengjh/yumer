import { describe, expect, it } from "vitest";
import { hashEditorDoc, shouldApplyRemoteContent } from "../hash";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("stale response guard", () => {
  it("allows remote content when editor hash is unchanged since request dispatch", () => {
    const doc: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "same" }] }],
    };

    const hash = hashEditorDoc(doc);

    expect(shouldApplyRemoteContent({
      hashAtDispatch: hash,
      currentEditorHash: hash,
      responseHash: hash,
    })).toBe(true);
  });

  it("rejects remote content when the editor changed after request dispatch", () => {
    const before: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }],
    };
    const current: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "after" }] }],
    };

    expect(shouldApplyRemoteContent({
      hashAtDispatch: hashEditorDoc(before),
      currentEditorHash: hashEditorDoc(current),
      responseHash: hashEditorDoc(before),
    })).toBe(false);
  });
});
