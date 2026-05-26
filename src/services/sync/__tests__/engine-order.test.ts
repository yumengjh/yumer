import { describe, expect, it } from "vitest";
import { deriveSyncEntries } from "../engine";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("deriveSyncEntries order handling", () => {
  it("creates a non-colliding sortKey when inserting between existing blocks", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_x" }, content: [{ type: "text", text: "inserted" }] },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };

    const entries = deriveSyncEntries(previous, next);
    const create = entries.find((entry) => entry.clientId === "c_x");

    expect(create?.opType).toBe("create");
    expect(create?.sortKey).toBe("001500");
  });

  it("emits move entries when existing blocks change relative order", () => {
    const previous: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
      ],
    };
    const next: TiptapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { clientId: "c_b", blockId: "b_b", sortKey: "002000" } },
        { type: "paragraph", attrs: { clientId: "c_a", blockId: "b_a", sortKey: "001000" } },
      ],
    };

    const entries = deriveSyncEntries(previous, next);

    expect(entries.some((entry) => entry.opType === "move" && entry.blockId === "b_b")).toBe(true);
  });
});
