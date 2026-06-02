// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MANUAL_SAVE_MODE,
  MANUAL_SAVE_MODE_STORAGE_KEY,
  normalizeManualSaveMode,
  readManualSaveMode,
  writeManualSaveMode,
} from "./manual-save-preferences";

describe("manual save preferences", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to incremental save", () => {
    expect(DEFAULT_MANUAL_SAVE_MODE).toBe("incremental");
    expect(normalizeManualSaveMode(undefined)).toBe("incremental");
    expect(normalizeManualSaveMode("invalid")).toBe("incremental");
    expect(readManualSaveMode()).toBe("incremental");
  });

  it("persists the selected manual save mode", () => {
    writeManualSaveMode("reload");

    expect(localStorage.getItem(MANUAL_SAVE_MODE_STORAGE_KEY)).toBe("reload");
    expect(readManualSaveMode()).toBe("reload");
  });
});
