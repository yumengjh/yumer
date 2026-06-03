import { describe, expect, it } from "vitest";
import {
  isNoopCommitError,
  shouldEnableLegacyAutoSave,
  shouldReloadAfterManualSave,
  shouldSkipManualCommit,
} from "../save-policy";

describe("save policy", () => {
  it("does not auto-save immediately after loading an unchanged legacy document", () => {
    expect(shouldEnableLegacyAutoSave({
      syncEngineEnabled: false,
      loadingDoc: false,
      hasCurrentDoc: true,
      contentDirty: false,
      content: "<p>loaded</p>",
    })).toBe(false);
  });

  it("does not run legacy auto-save for TipTap JSON documents", () => {
    expect(shouldEnableLegacyAutoSave({
      syncEngineEnabled: false,
      loadingDoc: false,
      hasCurrentDoc: true,
      contentDirty: true,
      content: { type: "doc" },
    })).toBe(false);
  });

  it("enables legacy auto-save only for dirty HTML documents when sync engine is disabled", () => {
    expect(shouldEnableLegacyAutoSave({
      syncEngineEnabled: false,
      loadingDoc: false,
      hasCurrentDoc: true,
      contentDirty: true,
      content: "<p>changed</p>",
    })).toBe(true);
  });

  it("reloads after manual save only when the selected sync-engine mode requests it", () => {
    expect(shouldReloadAfterManualSave({
      syncEngineEnabled: true,
      isJsonDocument: true,
      manualSaveMode: "incremental",
    })).toBe(false);
    expect(shouldReloadAfterManualSave({
      syncEngineEnabled: true,
      isJsonDocument: true,
      manualSaveMode: "reload",
    })).toBe(true);
    expect(shouldReloadAfterManualSave({
      syncEngineEnabled: false,
      isJsonDocument: true,
      manualSaveMode: "reload",
    })).toBe(false);
  });

  it("skips manual commit when there are no local changes to persist", () => {
    expect(shouldSkipManualCommit({
      syncEngineEnabled: true,
      isJsonDocument: true,
      hasUnsavedChanges: false,
      contentDirty: false,
    })).toBe(true);
    expect(shouldSkipManualCommit({
      syncEngineEnabled: true,
      isJsonDocument: true,
      hasUnsavedChanges: false,
      contentDirty: true,
    })).toBe(false);
    expect(shouldSkipManualCommit({
      syncEngineEnabled: true,
      isJsonDocument: true,
      hasUnsavedChanges: true,
      contentDirty: false,
    })).toBe(false);
    expect(shouldSkipManualCommit({
      syncEngineEnabled: false,
      isJsonDocument: false,
      hasUnsavedChanges: false,
      contentDirty: true,
    })).toBe(false);
  });

  it("treats backend no-draft commit errors as a successful no-op", () => {
    expect(isNoopCommitError(new Error("没有可提交的草稿"))).toBe(true);
    expect(isNoopCommitError(new Error("认证已过期，请重新登录"))).toBe(false);
    expect(isNoopCommitError("没有可提交的草稿")).toBe(true);
  });
});
