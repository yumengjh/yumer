import { describe, expect, it } from "vitest";
import { collectOrphanedCreateDeletes } from "../orphaned-create";
import type { TiptapDoc } from "@/services/tiptap-converter";

describe("orphaned create acknowledgements", () => {
  it("creates follow-up deletes when create ack returns for nodes no longer in the local snapshot", () => {
    const snapshot: TiptapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { clientId: "kept_client", blockId: "kept_block" },
          content: [{ type: "text", text: "kept" }],
        },
      ],
    };

    const deletes = collectOrphanedCreateDeletes(snapshot, [
      { clientId: "deleted_client", blockId: "server_orphan_1" },
      { clientId: "kept_client", blockId: "kept_block" },
    ]);

    expect(deletes).toEqual([
      {
        clientId: "deleted_client",
        blockId: "server_orphan_1",
        opType: "delete",
      },
    ]);
  });
});
