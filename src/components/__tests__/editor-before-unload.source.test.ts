import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("EditorPage beforeunload guard", () => {
  it("gates beforeunload handling with confirmBeforeLeave", () => {
    const source = readFileSync("src/components/EditorPage.tsx", "utf8");

    expect(source).toContain("activeSettingsState.effectiveSettings.editor.confirmBeforeLeave");
  });
});
