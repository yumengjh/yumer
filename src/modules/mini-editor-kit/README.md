# Mini Editor Kit

Compact editor entry for form-like writing surfaces such as bug reports, comments, notes, and lightweight descriptions.

## Public Entry

```ts
import { MiniMarkdownEditor } from "@/modules/mini-editor-kit";
```

The mini editor reuses `editor-kit` internals, but defaults to:

- no document title field
- no table of contents
- compact input-style chrome
- a reduced toolbar for common writing actions

## Default Toolbar

The default toolbar keeps:

- undo / redo
- bold / italic / strike / underline
- bullet / ordered / checklist
- quote
- code block
- link
- clear format

Use `toolbarItemIds` to further reduce the visible tools.
