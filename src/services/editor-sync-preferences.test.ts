import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_SYNC_PREFERENCES,
  normalizeEditorSyncPreferences,
} from "./editor-sync-preferences";

describe("editor sync preferences", () => {
  it("uses local defaults", () => {
    expect(normalizeEditorSyncPreferences({})).toEqual(DEFAULT_EDITOR_SYNC_PREFERENCES);
  });

  it("normalizes stored sync behavior settings", () => {
    expect(
      normalizeEditorSyncPreferences({
        documentSyncDelayMs: 450.6,
        autoRememberEditPosition: false,
      }),
    ).toEqual({
      documentSyncDelayMs: 451,
      autoRememberEditPosition: false,
    });
  });

  it("clamps document sync delay", () => {
    expect(
      normalizeEditorSyncPreferences({ documentSyncDelayMs: -10 }).documentSyncDelayMs,
    ).toBe(200);
    expect(
      normalizeEditorSyncPreferences({ documentSyncDelayMs: 9999 }).documentSyncDelayMs,
    ).toBe(3000);
  });
});
