# Code Block Client Rendering Design

## Goal

Enhance rich-text `codeBlock` nodes with per-block display settings and move public-page code block highlighting to the browser. Normal document blocks continue to use backend-rendered HTML from `content?mode=all`; code blocks remain JSON-driven and are rendered dynamically on the client.

## Scope

- Extend the Tiptap `codeBlock` JSON payload through `attrs`.
- Improve the editor code block node view with a status bar and settings controls.
- Render public-page code blocks from placeholders in the browser.
- Preserve block-level backend HTML rendering for non-code blocks.
- Keep JSON fallback rendering for blocks without backend HTML.

This does not replace the whole public document rendering pipeline with client rendering.

## Data Model

Code block settings are stored on `payload.attrs`:

```ts
type CodeBlockAttrs = {
  language?: string;
  codeTheme?: "auto" | "github-light" | "github-dark";
  fontSize?: "inherit" | "12px" | "13px" | "14px" | "16px";
  indentMode?: "space" | "tab";
  indentSize?: 2 | 4 | 8;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  autoIndent?: boolean;
  title?: string;
  statusBarCollapsed?: boolean;
  codeCollapsed?: boolean;
};
```

Defaults are applied at render time so existing documents remain valid:

- `language`: `text`
- `codeTheme`: `auto`
- `fontSize`: `inherit`
- `indentMode`: `space`
- `indentSize`: `2`
- `wordWrap`: `false`
- `lineNumbers`: `true`
- `autoIndent`: `true`
- `title`: empty
- `statusBarCollapsed`: `false`
- `codeCollapsed`: `false`

## Editor Experience

The existing `CodeBlockView` becomes the single editor-side custom code block component.

It renders:

- Status bar with title, language, theme, font size, indentation, wrapping, line numbers, and auto-indent controls.
- A button to collapse the status bar.
- A button to collapse the code body, shown only when the status bar is visible.
- Code content using `NodeViewContent`, preserving Tiptap editing behavior.

The Shiki decoration plugin remains responsible for editor syntax highlighting. Attribute changes trigger normal Tiptap updates and are persisted through the existing JSON save path.

## Public Page Rendering

`app/doc/[slug]/page.tsx` continues fetching:

```txt
/documents/:docId/content?mode=all
```

Rendering rules:

1. If a non-code block has backend `html`, use it.
2. If a non-code block has no `html`, render its JSON locally with the existing static renderer fallback.
3. If a block is `codeBlock`, output a placeholder containing serialized code block data.
4. A client component scans placeholders after hydration, loads Shiki, renders highlighted HTML, and replaces the placeholder contents.
5. If Shiki rendering fails, the client renders a readable plain `<pre><code>` fallback.

The public page no longer calls `highlightCodeBlocks(...)` during SSR.

## Components

New or changed units:

- `CodeBlockView.tsx`: editor node view with controls and per-block state.
- `codeBlockOptions.ts`: shared defaults, normalizers, option lists, and text extraction helpers.
- `ClientCodeBlockRenderer.tsx`: public-page client renderer for placeholders.
- `generate-block-html.ts`: emits code block placeholders and keeps non-code fallback behavior.
- `editor.css` / public doc styles: shared code block layout, collapsed states, line numbers, wrapping, and status bar.

## Error Handling

- Unknown languages fall back to `text`.
- Unknown themes fall back to automatic light/dark resolution.
- Invalid option values are normalized to defaults.
- Client rendering failure keeps content visible as escaped plain text.
- Missing code content renders an empty editable/readable code block shell.

## Testing

Unit tests should cover:

- `codeBlock` placeholder output from `renderBlockTreeToHtml`.
- Non-code blocks still prefer backend HTML and fallback to JSON rendering.
- Public page no longer imports or calls server-side `highlightCodeBlocks`.
- Code block option normalization for invalid/missing attrs.
- Client-render fallback helper escapes plain text safely.

Manual verification should cover:

- Creating and editing a code block.
- Changing language, theme, font size, indentation, wrapping, line numbers, title, and collapse states.
- Opening a public document with code blocks and confirming placeholders become highlighted blocks in the browser.
