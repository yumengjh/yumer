import type { Editor } from "@tiptap/core";
import {
  cleanupCodeBlocks,
  type CodeCleanupActionKey,
  type CodeCleanupResult,
} from "./codeBlockCleanup";
import { convertSelectedListsToInlineParagraph } from "./listInlineCleanup";

export type EditorCleanupActionKey =
  | CodeCleanupActionKey
  | "convertSelectedListsToInline";

const CODE_BLOCK_CLEANUP_ACTIONS = new Set<CodeCleanupActionKey>([
  "removeTrailingBlankLines",
  "removeEmptyCodeBlocks",
  "collapseStatusBars",
  "expandStatusBars",
  "enableLineNumbers",
  "disableLineNumbers",
]);

function isCodeBlockCleanupAction(
  action: EditorCleanupActionKey,
): action is CodeCleanupActionKey {
  return CODE_BLOCK_CLEANUP_ACTIONS.has(action as CodeCleanupActionKey);
}

export function runEditorCleanupAction(
  editor: Editor | null,
  action: EditorCleanupActionKey,
): CodeCleanupResult {
  if (isCodeBlockCleanupAction(action)) {
    return cleanupCodeBlocks(editor, action);
  }

  return convertSelectedListsToInlineParagraph(editor);
}
