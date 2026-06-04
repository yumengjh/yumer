import { describe, expect, it } from "vitest";
import {
  hasDiscardableDraft,
  isNoopCommitError,
  isNoopDiscardDraftError,
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

  it("treats loaded drafts and local edits as discardable draft state", () => {
    expect(hasDiscardableDraft({
      currentContentSource: "draft",
      currentDraftExists: false,
      hasUnsavedChanges: false,
      contentDirty: false,
    })).toBe(true);
    expect(hasDiscardableDraft({
      currentContentSource: "head",
      currentDraftExists: true,
      hasUnsavedChanges: false,
      contentDirty: false,
    })).toBe(true);
    expect(hasDiscardableDraft({
      currentContentSource: "head",
      currentDraftExists: false,
      hasUnsavedChanges: true,
      contentDirty: false,
    })).toBe(true);
    expect(hasDiscardableDraft({
      currentContentSource: "head",
      currentDraftExists: false,
      hasUnsavedChanges: false,
      contentDirty: false,
    })).toBe(false);
  });

  it("skips manual commit only when there is no draft state to persist", () => {
    expect(shouldSkipManualCommit({
      syncEngineEnabled: true,
      isJsonDocument: true,
      hasDiscardableDraft: false,
      contentDirty: false,
    })).toBe(true);
    expect(shouldSkipManualCommit({
      syncEngineEnabled: true,
      isJsonDocument: true,
      hasDiscardableDraft: true,
      contentDirty: false,
    })).toBe(false);
    expect(shouldSkipManualCommit({
      syncEngineEnabled: true,
      isJsonDocument: true,
      hasDiscardableDraft: true,
      contentDirty: true,
    })).toBe(false);
    expect(shouldSkipManualCommit({
      syncEngineEnabled: false,
      isJsonDocument: false,
      hasDiscardableDraft: false,
      contentDirty: true,
    })).toBe(false);
  });

  it("treats backend no-draft commit errors as a successful no-op", () => {
    expect(isNoopCommitError(new Error("没有可提交的草稿"))).toBe(true);
    expect(isNoopCommitError(new Error("认证已过期，请重新登录"))).toBe(false);
    expect(isNoopCommitError("没有可提交的草稿")).toBe(true);
  });

  it("treats backend no-draft discard errors as a successful no-op", () => {
    expect(isNoopDiscardDraftError(new Error("没有草稿可丢弃"))).toBe(true);
    expect(isNoopDiscardDraftError(new Error("草稿不存在"))).toBe(true);
    expect(isNoopDiscardDraftError(new Error("认证已过期，请重新登录"))).toBe(false);
  });
});
