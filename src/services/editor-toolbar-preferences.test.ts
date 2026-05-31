import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_TOOLBAR_PREFERENCES,
  getEnabledFloatingToolbarItemIds,
  normalizeEditorToolbarPreferences,
} from "./editor-toolbar-preferences";

describe("editor toolbar preferences", () => {
  it("uses conservative defaults", () => {
    expect(normalizeEditorToolbarPreferences({})).toEqual(DEFAULT_EDITOR_TOOLBAR_PREFERENCES);
  });

  it("normalizes stored floating toolbar settings", () => {
    const normalized = normalizeEditorToolbarPreferences({
      floatingToolbarEnabled: true,
      showFixedToolbarWithFloating: true,
      floatingItems: {
        bold: false,
        table: true,
        unknown: true,
      },
    });

    expect(normalized.floatingToolbarEnabled).toBe(true);
    expect(normalized.showFixedToolbarWithFloating).toBe(true);
    expect(normalized.floatingToolbarDelayMs).toBe(180);
    expect(normalized.floatingItems.bold).toBe(false);
    expect(normalized.floatingItems.table).toBe(true);
    expect("unknown" in normalized.floatingItems).toBe(false);
  });

  it("clamps floating toolbar delay", () => {
    expect(
      normalizeEditorToolbarPreferences({ floatingToolbarDelayMs: -10 }).floatingToolbarDelayMs,
    ).toBe(0);
    expect(
      normalizeEditorToolbarPreferences({ floatingToolbarDelayMs: 9999 }).floatingToolbarDelayMs,
    ).toBe(1200);
  });

  it("returns enabled floating toolbar item ids in menu order", () => {
    const ids = getEnabledFloatingToolbarItemIds({
      ...DEFAULT_EDITOR_TOOLBAR_PREFERENCES,
      floatingItems: {
        ...DEFAULT_EDITOR_TOOLBAR_PREFERENCES.floatingItems,
        bold: false,
        table: true,
      },
    });

    expect(ids.includes("bold")).toBe(false);
    expect(ids.at(-1)).toBe("table");
  });
});
