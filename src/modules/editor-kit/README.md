# Editor Kit

Reusable editor module intended to be copied into another React codebase as a directory.

## Public Entry

Import from:

```ts
import { MarkdownEditor } from "@/modules/editor-kit";
```

For server-safe helpers and shared utilities, import from:

```ts
import { normalizeCodeBlockAttrs } from "@/modules/editor-kit/shared";
```

Current root exports from [index.ts](</E:/workspace/editor-demo/app/src/modules/editor-kit/index.ts:1>):

- `MarkdownEditor`
- `Toolbar`
- `useMarkdownEditor`
- code block normalization and rendering helpers
- code highlighting helpers
- public code block chrome helpers
- heading id helpers
- floating toolbar item metadata
- extension constructors used by serialization
- editor content types
- upload handler types

## Required Host Responsibilities

Keep these outside the module:

- routing
- auth and permissions
- document loading and saving
- upload API implementation
- workspace or tenant selection

## Upload Contract

Inject image upload from the host:

```ts
onUploadImage?: (file: File) => Promise<{
  assetId: string;
  url: string;
  width?: number | null;
  height?: number | null;
}>
```

The editor should never know how the file is uploaded.

## Styling

Import:

```ts
import "@/modules/editor-kit/styles/editor.css";
```

That compatibility stylesheet pulls in the shared content styles from `src/modules/content-styles/content.css`.

## Current Constraint

`editor-kit` still depends on Tiptap, Ant Design, and the project's existing editor extension stack. It is React-pluggable now, but not package-manager-independent yet.
