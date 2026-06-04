# Module Guide

This project is being split into copyable React modules instead of page-level features.

## Directories

- `src/modules/editor-kit`
  Reusable editor module. Contains `MarkdownEditor`, toolbar, extensions, code block behavior, editor types, and editor-local styles.
- `src/modules/viewer-kit`
  Reusable viewer module. Contains document header/layout, table of contents, heading anchor enhancement, code block enhancement, and image preview.
- `src/modules/content-styles`
  Shared content typography and block rendering styles. This is the single source of truth for editor content and viewer content.

## Copy Into Another React Project

Copy these directories together:

- `src/modules/editor-kit`
- `src/modules/viewer-kit`
- `src/modules/content-styles`

If you only need read-only rendering, `viewer-kit` plus `content-styles` is enough.

## CSS Contract

Import shared content styles in both editor and viewer hosts:

```ts
import "@/modules/content-styles/content.css";
```

`editor-kit/styles/editor.css` is a compatibility entry that re-exports the shared content styles for editor consumers.

`viewer-kit` imports its own shell/layout CSS internally:

- `DocumentHeader`
- `DocumentLayout`
- `DocumentTableOfContents`

## Editor Kit Contract

Current stable host-facing contract:

- `value`
- `onChange`
- `title`
- `onTitleChange`
- `readOnly`
- `theme`
- `onUploadImage`

Host-specific behavior must stay outside the module:

- routing
- auth/session
- document fetch/save
- upload API implementation
- workspace selection

`onUploadImage(file)` is the main injection point for image upload.

## Viewer Kit Contract

Current reusable viewer building blocks:

- `DocumentLayout`
- `DocumentHeader`
- `DocumentTableOfContents`
- `HeadingAnchorEnhancer`
- `CodeBlockEnhancer`
- `ImagePreview`

Expected viewer host responsibilities:

- fetch document html/json
- choose title/icon/back link
- provide footer content
- decide content width / font size

Typical page composition:

```tsx
<DocumentLayout
  title={doc.title}
  icon={<span>{doc.icon}</span>}
  backHref="/docs"
  sidebar={<DocumentTableOfContents />}
  contentWidth={800}
  fontSize={16}
>
  <div className="doc-content" dangerouslySetInnerHTML={{ __html: doc.html }} />
  <HeadingAnchorEnhancer />
  <CodeBlockEnhancer />
  <ImagePreview />
</DocumentLayout>
```

## Current App Adapters

These files are still project-specific wrappers around the reusable modules:

- `src/components/EditorPage.tsx`
- `src/components/DocPageLayout.tsx`
- `src/components/DeferredCodeBlockRenderer.tsx`
- `src/components/DeferredDocImagePreview.tsx`

They should remain thin. If business logic grows, keep it here instead of pushing it back into `editor-kit` or `viewer-kit`.
