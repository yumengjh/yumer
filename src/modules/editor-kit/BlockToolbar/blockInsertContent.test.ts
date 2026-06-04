import { describe, expect, it } from "vitest";
import { createBlockInsertContent } from "./blockInsertContent";

describe("block insert content", () => {
  it("builds a task list scaffold", () => {
    expect(createBlockInsertContent("taskList")).toEqual({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph" }],
        },
      ],
    });
  });

  it("builds a 3x3 table scaffold with header row", () => {
    const table = createBlockInsertContent("table");
    expect(table.type).toBe("table");
    expect(table.content).toHaveLength(3);
    expect(table.content?.[0]).toMatchObject({
      type: "tableRow",
      content: [{ type: "tableHeader" }, { type: "tableHeader" }, { type: "tableHeader" }],
    });
  });
});
