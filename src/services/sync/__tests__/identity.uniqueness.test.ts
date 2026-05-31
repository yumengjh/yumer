import { describe, expect, it } from "vitest";
import { ensureDocumentIdentity } from "../identity";

describe("identity uniqueness", () => {
  it("fixes duplicated clientId across top-level blocks", () => {
    const doc = ensureDocumentIdentity({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "same-client" },
          content: [{ type: "text", text: "a" }],
        },
        {
          type: "paragraph",
          attrs: { clientId: "same-client" },
          content: [{ type: "text", text: "b" }],
        },
      ],
    });

    const first = doc.content?.[0].attrs?.clientId as string;
    const second = doc.content?.[1].attrs?.clientId as string;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("clears duplicated blockId on later nodes so they can be treated as create", () => {
    const doc = ensureDocumentIdentity({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "b_dup", clientId: "c1" },
          content: [{ type: "text", text: "a" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "b_dup", clientId: "c2" },
          content: [{ type: "text", text: "b" }],
        },
      ],
    });

    expect(doc.content?.[0].attrs?.blockId).toBe("b_dup");
    expect(doc.content?.[1].attrs?.blockId).toBeUndefined();
    expect(doc.content?.[1].attrs?.["data-block-id"]).toBeUndefined();
  });

  it("assigns a new clientId when a nested node duplicates a later top-level block", () => {
    const doc = ensureDocumentIdentity({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { clientId: "list_1" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { clientId: "reused_client" },
                  content: [{ type: "text", text: "inside list" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { clientId: "reused_client" },
          content: [{ type: "text", text: "middle block" }],
        },
      ],
    });

    const nestedParagraph = doc.content?.[0].content?.[0].content?.[0];
    const topLevelParagraph = doc.content?.[1];

    expect(nestedParagraph?.attrs?.clientId).toBe("reused_client");
    expect(topLevelParagraph?.attrs?.clientId).toEqual(expect.any(String));
    expect(topLevelParagraph?.attrs?.clientId).not.toBe("reused_client");
  });
});
