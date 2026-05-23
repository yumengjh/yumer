import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  buildSettingsState,
  buildUserSettingsPatch,
  buildWorkspaceSettingsPatch,
  extractSettings,
  normalizeSettings,
  normalizeUserSettings,
  resolveSettings,
} from "./settings";

describe("settings service helpers", () => {
  it("extracts nested settings envelopes", () => {
    expect(
      extractSettings({
        settings: {
          reader: { contentWidth: 920 },
        },
      }),
    ).toEqual({
      reader: { contentWidth: 920 },
    });
  });

  it("normalizes partial settings with defaults", () => {
    expect(
      normalizeSettings({
        settings: {
          reader: { contentWidth: 920 },
          editor: { fontSize: 18 },
        },
      }),
    ).toEqual({
      reader: {
        contentWidth: 920,
        fontSize: DEFAULT_APP_SETTINGS.reader.fontSize,
      },
      editor: {
        contentWidth: DEFAULT_APP_SETTINGS.editor.contentWidth,
        fontSize: 18,
      },
    });
  });

  it("clamps outgoing values to backend limits", () => {
    expect(
      buildWorkspaceSettingsPatch({
        reader: { contentWidth: 3000, fontSize: 1 },
        editor: { contentWidth: 100, fontSize: 99 },
      }),
    ).toEqual({
      settings: {
        reader: { contentWidth: 1200, fontSize: 13 },
        editor: { contentWidth: 680, fontSize: 22 },
      },
    });
  });

  it("resolves workspace-first priority", () => {
    expect(
      resolveSettings(
        {
          editor: { contentWidth: 910, fontSize: 18 },
        },
        {
          reader: { contentWidth: 860, fontSize: 15 },
          editor: { contentWidth: 870, fontSize: 16 },
        },
        "workspace-first",
      ),
    ).toEqual({
      reader: { contentWidth: 860, fontSize: 15 },
      editor: { contentWidth: 870, fontSize: 16 },
    });
  });

  it("resolves user-first priority", () => {
    expect(
      resolveSettings(
        {
          editor: { contentWidth: 910, fontSize: 18 },
        },
        {
          reader: { contentWidth: 860, fontSize: 15 },
          editor: { contentWidth: 870, fontSize: 16 },
        },
        "user-first",
      ),
    ).toEqual({
      reader: { contentWidth: 860, fontSize: 15 },
      editor: { contentWidth: 910, fontSize: 18 },
    });
  });

  it("user settings only keep editor fields", () => {
    expect(
      normalizeUserSettings({
        settings: {
          reader: { contentWidth: 920, fontSize: 17 },
          editor: { fontSize: 19 },
        },
      }),
    ).toEqual({
      editor: {
        contentWidth: DEFAULT_USER_SETTINGS.editor.contentWidth,
        fontSize: 19,
      },
    });
  });

  it("builds user patch with editor fields only", () => {
    expect(
      buildUserSettingsPatch({
        editor: { contentWidth: 9999, fontSize: 1 },
      }),
    ).toEqual({
      settings: {
        editor: {
          contentWidth: 1200,
          fontSize: 13,
        },
      },
    });
  });

  it("builds a reusable combined settings state", () => {
    const state = buildSettingsState({
      userSettings: { settings: { reader: { fontSize: 20 }, editor: { fontSize: 20 } } },
      workspaceSettings: { settings: { reader: { contentWidth: 860 } } },
      priority: "workspace-first",
    });

    expect(state.priority).toBe("workspace-first");
    expect(state.userSettings.editor.fontSize).toBe(20);
    expect(state.workspaceSettings.reader.contentWidth).toBe(860);
    expect(state.effectiveSettings.reader.contentWidth).toBe(860);
  });
});
