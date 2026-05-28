# Editor Toolbar Code Cleanup Utilities Design

## Goal

Add and extend a split-dropdown toolbar group for personal code block batch actions in the editor. The left primary button runs the current default action, and the right dropdown lets the user choose another action, immediately runs it once, and makes it the new default for the current component state.

## Scope

This design adds a toolbar group named `代码清理` with six document-wide code-block actions:

1. Remove trailing blank lines from all code blocks in the current document.
2. Delete all empty code blocks whose content is empty or whitespace-only.
3. Collapse the status bar for all code blocks.
4. Expand the status bar for all code blocks.
5. Enable line numbers for all code blocks.
6. Disable line numbers for all code blocks.

This work is limited to the editor toolbar and code block batch-processing behavior. It does not add shortcuts, context-menu entries, modal confirmations, persistence of the selected default action, or cleanup for non-code-block content.

## User Experience

The toolbar includes a split dropdown that matches the existing toolbar interaction model:

- The left main button runs the current default action.
- The right dropdown arrow opens a menu of available actions.
- Choosing a menu item immediately runs that action once.
- After a menu item is chosen, that action becomes the new default action for the left main button during the current mounted session.

Initial default action:

- `移除代码块末尾空行`

Menu items:

- `移除代码块末尾空行`
- `删除空代码块`
- divider
- `全部折叠状态栏`
- `全部展开状态栏`
- divider
- `全部打开行号`
- `全部关闭行号`

After execution, the editor shows a lightweight status message:

- Success with affected count when changes were made.
- Informational message when nothing matched or everything was already in the requested state.

## Behavior Rules

### Action 1: Remove trailing blank lines from code blocks

Target:

- Only Tiptap `codeBlock` nodes.

Rule:

- If the end of a code block contains one or more blank lines, remove all trailing blank lines.
- A blank trailing line means the last line is empty or contains only whitespace characters.
- Internal blank lines inside a code block are preserved.
- Non-code-block nodes are ignored.
- A code block that becomes empty after trimming trailing blank lines is still kept by this action.

### Action 2: Delete empty code blocks

Target:

- Only Tiptap `codeBlock` nodes.

Rule:

- Delete the entire `codeBlock` node if its textual content is empty after whitespace trimming.
- Nodes with visible non-whitespace content are preserved.
- Non-code-block nodes are ignored.

### Action 3: Collapse all code block status bars

Target:

- Only Tiptap `codeBlock` nodes.

Rule:

- Set `statusBarCollapsed: true` on every code block whose current normalized value is not already `true`.
- Do not change `codeCollapsed`.
- Code blocks already collapsed are counted as unchanged.

Messages:

- Changed: `已折叠 X 个代码块的状态栏`
- Unchanged: `所有代码块状态栏已折叠`

### Action 4: Expand all code block status bars

Target:

- Only Tiptap `codeBlock` nodes.

Rule:

- Set `statusBarCollapsed: false` on every code block whose current normalized value is not already `false`.
- Do not change `codeCollapsed`.
- Code blocks already expanded are counted as unchanged.

Messages:

- Changed: `已展开 X 个代码块的状态栏`
- Unchanged: `所有代码块状态栏已展开`

### Action 5: Enable line numbers for all code blocks

Target:

- Only Tiptap `codeBlock` nodes.

Rule:

- Set `lineNumbers: true` on every code block whose current normalized value is not already `true`.
- Code blocks already showing line numbers are counted as unchanged.

Messages:

- Changed: `已打开 X 个代码块的行号`
- Unchanged: `所有代码块行号已打开`

### Action 6: Disable line numbers for all code blocks

Target:

- Only Tiptap `codeBlock` nodes.

Rule:

- Set `lineNumbers: false` on every code block whose current normalized value is not already `false`.
- Code blocks already hiding line numbers are counted as unchanged.

Messages:

- Changed: `已关闭 X 个代码块的行号`
- Unchanged: `所有代码块行号已关闭`

## Architecture

Use a lightweight command-style utility layer plus toolbar integration:

- Toolbar UI remains in the existing toolbar components.
- Batch code-block logic remains extracted in the dedicated `codeBlockCleanup` utility module.
- The utility module now supports both content cleanup actions and attribute update actions.
- Toolbar handlers call the cleanup utilities, dispatch one transaction, and show a message based on the result.

This keeps the current change small while making it easy to add future document-level code-block actions.

## Components and Responsibilities

### Toolbar UI

Expected changed files:

- `src/components/markdown-editor/Toolbar/DesktopToolbar.tsx`
- `src/components/markdown-editor/Toolbar/data.ts`

Responsibilities:

- Define the `代码清理` group menu structure.
- Keep current default action in component state.
- Run the default action from the left button.
- Run a selected action from the dropdown and update the current default action.
- Show success/info toast messages.

### Cleanup utilities

Expected changed module:

- `src/components/markdown-editor/code/codeBlockCleanup.ts`

Responsibilities:

- Traverse the current ProseMirror document.
- Collect all code-block edits safely.
- Apply edits in reverse document order to avoid position drift.
- Support both text replacement/deletion and attribute updates.
- Return a structured result with changed flag and affected count.

Possible result shape:

```ts
type CodeCleanupResult = {
  changed: boolean;
  affectedCount: number;
};
```

## Data Flow

For any toolbar action:

1. User clicks the left primary button or selects an item from the dropdown.
2. Toolbar resolves which action to run.
3. Toolbar calls the corresponding cleanup utility with the current editor instance.
4. Utility scans the document, builds a transaction, and applies all changes once.
5. Utility returns whether any nodes changed and how many were affected.
6. Toolbar shows a message and refreshes its local default action state if the action came from dropdown selection.

## Transaction Strategy

Document-wide block edits must be position-safe.

Recommended approach:

- Traverse the document and collect target code blocks with their positions first.
- For text cleanup actions, compute replacement text before mutating.
- For delete actions, record node ranges to delete.
- For attribute update actions, create replacement nodes with merged attrs only when the target value differs from the normalized current value.
- Apply replacements/deletions from the end of the document toward the start.

This avoids offset corruption when multiple code blocks are changed in one run.

## Error Handling

- If no editor instance exists, the action does nothing.
- If no matching code blocks are found, show a non-error informational message.
- If transaction building produces no real changes, do not dispatch a no-op transaction.
- Unexpected node shapes should be ignored rather than crashing the toolbar.
- Attribute actions should normalize current attrs before deciding whether a node needs updating.

## Testing

Unit tests should cover the cleanup utility behavior independently of toolbar rendering.

Expected test cases:

### Text cleanup

- Removes one trailing empty line from a code block.
- Removes multiple trailing empty lines from a code block.
- Removes trailing whitespace-only lines.
- Preserves internal blank lines.
- Deletes whitespace-only code blocks.
- Leaves non-code-block nodes unchanged.

### Batch attribute actions

- Collapses all status bars that are currently expanded.
- Expands all status bars that are currently collapsed.
- Enables line numbers for all code blocks currently disabled.
- Disables line numbers for all code blocks currently enabled.
- Returns unchanged when every target node is already in the requested state.
- Preserves unrelated attrs like `language`, `title`, and `codeCollapsed`.

### Toolbar integration

- The cleanup group still renders in the desktop toolbar.
- The initial default action remains `移除代码块末尾空行`.
- Clicking the primary side runs the current default action.
- Selecting a dropdown action runs it immediately.
- Selecting a dropdown action updates the in-memory default action.
- Source-level integration checks should include the new action keys and menu wiring.

## Out of Scope

The following are intentionally excluded from this change:

- Persisting the chosen default action across refreshes
- Keyboard shortcuts
- Mobile toolbar integration unless current architecture requires it
- Block menu or right-click menu integration
- Cleanup for paragraphs, blockquotes, lists, tables, or inline code
- Additional bulk code-block options such as theme/font size/wrap/auto-indent
- Coupling status-bar actions to `codeCollapsed`

## Acceptance Criteria

This feature is complete when:

- The desktop editor toolbar `代码清理` menu contains the six agreed actions in the specified grouped order.
- The primary side still runs `移除代码块末尾空行` by default.
- Selecting any dropdown item both executes it and makes it the current default action.
- Status bar actions only update `statusBarCollapsed`.
- Line number actions only update `lineNumbers`.
- Existing text cleanup behavior remains unchanged.
- User feedback messages distinguish changed vs unchanged runs for all six actions.
- Automated tests cover the new attribute batch actions and menu integration.
