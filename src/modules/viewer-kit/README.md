# Viewer Kit

Reusable viewer module for rendering already-produced document HTML inside a React app.

## Public Entry

Import from:

```ts
import {
  DocumentLayout,
  DocumentTableOfContents,
  HeadingAnchorEnhancer,
  CodeBlockEnhancer,
  ImagePreview,
} from "@/modules/viewer-kit";
```

Root exports from [index.ts](</E:/workspace/editor-demo/app/src/modules/viewer-kit/index.ts:1>):

- `DocumentLayout`
- `DocumentHeader`
- `DocumentTableOfContents`
- `HeadingAnchorEnhancer`
- `CodeBlockEnhancer`
- `ImagePreview`
- heading anchor helpers

Prefer importing from the module root instead of internal files.

## Expected Input

`viewer-kit` expects already-rendered content, typically:

- html string from backend
- title and optional icon
- optional sidebar node
- optional footer node

It does not fetch documents by itself.

## Styling

Always import shared content styles:

```ts
import "@/modules/content-styles/content.css";
```

`viewer-kit` components also import their own shell CSS internally for layout, header, and toc behavior.

## Host Responsibilities

Keep these outside the module:

- routing implementation
- data fetching
- access control
- footer/business metadata
- reader settings persistence

For frameworks like Next.js, dynamic client-only wrappers such as deferred code highlighting should stay in the host app layer.
