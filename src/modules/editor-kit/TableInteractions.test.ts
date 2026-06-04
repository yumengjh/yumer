import { describe, expect, it } from "vitest";
import { createTableMenuItems, TABLE_CONTEXT_MENU_WIDTH, TABLE_CONTEXT_MENU_MIN_HEIGHT } from "./TableInteractions";

describe("TableInteractions menu config", () => {
  it("includes compact table setting toggles", () => {
    const items = createTableMenuItems({
      hideOuterBorder: false,
      equalWidth: true,
      headerRow: false,
      headerColumn: true,
    });

    const keys = (items ?? [])
      .flatMap((item) => (item && "key" in item && typeof item.key === "string" ? [item.key] : []));

    expect(keys).toContain("toggle-hide-outer-border");
    expect(keys).toContain("toggle-equal-width");
    expect(keys).toContain("toggle-header-row");
    expect(keys).toContain("toggle-header-column");
  });

  it("uses smaller menu dimensions for the compact context menu", () => {
    expect(TABLE_CONTEXT_MENU_WIDTH).toBeLessThan(280);
    expect(TABLE_CONTEXT_MENU_MIN_HEIGHT).toBeLessThan(420);
  });
});
