export type SavePolicyContent = string | { type?: string } | null | undefined;

export function shouldEnableLegacyAutoSave(input: {
  syncEngineEnabled: boolean;
  loadingDoc: boolean;
  hasCurrentDoc: boolean;
  contentDirty: boolean;
  content: SavePolicyContent;
}): boolean {
  return Boolean(
    input.hasCurrentDoc &&
      !input.loadingDoc &&
      !input.syncEngineEnabled &&
      input.contentDirty &&
      typeof input.content === "string",
  );
}

export function shouldReloadAfterManualSave(input: {
  syncEngineEnabled: boolean;
  isJsonDocument: boolean;
  manualSaveMode: "incremental" | "reload";
}): boolean {
  return Boolean(
    input.syncEngineEnabled &&
      input.isJsonDocument &&
      input.manualSaveMode === "reload",
  );
}

export function hasDiscardableDraft(input: {
  currentContentSource: "draft" | "head" | null;
  currentDraftExists: boolean;
  hasUnsavedChanges: boolean;
  contentDirty?: boolean;
}): boolean {
  return Boolean(
    input.currentContentSource === "draft" ||
      input.currentDraftExists ||
      input.hasUnsavedChanges ||
      input.contentDirty,
  );
}

export function shouldSkipManualCommit(input: {
  syncEngineEnabled: boolean;
  isJsonDocument: boolean;
  hasDiscardableDraft: boolean;
  contentDirty: boolean;
}): boolean {
  if (input.syncEngineEnabled && input.isJsonDocument) {
    return !input.hasDiscardableDraft;
  }

  return !input.contentDirty;
}

export function isNoopCommitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("没有可提交的草稿");
}

export function isNoopDiscardDraftError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("没有草稿") ||
    message.includes("草稿不存在") ||
    message.toLowerCase().includes("draft not found")
  );
}
