import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DesktopToolbar code cleanup integration", () => {
  it("wires the extended code cleanup split dropdown with grouped menu actions", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/Toolbar/DesktopToolbar.tsx"),
      "utf8",
    );

    expect(source).toContain('id: "code-cleanup"');
    expect(source).toContain('type: "code-cleanup-picker"');
    expect(source).toContain('useState<EditorCleanupActionKey>(');
    expect(source).toContain('"removeTrailingBlankLines"');
    expect(source).toContain('collapseStatusBars');
    expect(source).toContain('expandStatusBars');
    expect(source).toContain('enableLineNumbers');
    expect(source).toContain('disableLineNumbers');
    expect(source).toContain('runCodeCleanupAction(defaultCodeCleanupAction)');
    expect(source).toContain('setDefaultCodeCleanupAction(cleanupItem.key)');
    expect(source).toContain('runCodeCleanupAction(cleanupItem.key)');
    expect(source).toContain('isCodeCleanupActionItem(cleanupItem)');
    expect(source).toContain('runEditorCleanupAction(tiptap, action)');
    expect(source).toContain('result.affectedCount');
  });
});
