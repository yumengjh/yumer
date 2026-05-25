# Editor Image Support Design

Date: 2026-05-25

## Goal

Add first-class image support to the editor frontend and a dedicated image upload module to the backend at `E:\workspace\yuweb\back\server`.

The feature supports:

- Paste image files into the editor.
- Upload images from an editor toolbar button.
- Store image metadata and display parameters in Tiptap JSON.
- Select/focus images and edit non-destructive display parameters.
- Resize images with visual handles.
- View images with a mature preview library.
- Serve images for private editing and public published documents.

The first version does not generate derived image files for crop or rotation. All rotation, crop, link, alignment, description, and size values are saved as node attributes.

## Existing Context

The frontend is a Next.js app using Tiptap, Ant Design, and a block-based sync path. The editor lives under `src/components/markdown-editor`, with toolbar code in `src/components/markdown-editor/Toolbar` and Tiptap serialization in `src/services/tiptap-extensions.ts`.

The backend is a NestJS app with module boundaries under `src/modules`. It already has an `assets` module that stores uploaded files through the `Asset` entity and local upload directory. That module is generic and accepts any file type, so image behavior should be exposed through a dedicated `images` module while reusing shared storage concepts where useful.

## Recommended Approach

Use a dedicated Tiptap block node named `imageBlock` and a backend `images` module.

The `imageBlock` node gives the editor direct control over selection, resize handles, hover toolbar, crop display, link wrapping, and preview integration. The backend `images` module keeps image validation and image-specific response shape out of the generic asset controller.

## Image Node Schema

The editor stores image display metadata in JSON:

```ts
{
  type: "imageBlock",
  attrs: {
    imageId: string;
    src: string;
    filename: string;
    mimeType: string;
    size: number;
    naturalWidth: number | null;
    naturalHeight: number | null;
    width: number | null;
    height: number | null;
    alt: string;
    align: "left" | "center" | "right";
    rotate: 0 | 90 | 180 | 270;
    crop: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    linkHref: string;
    linkTarget: "_self" | "_blank";
  }
}
```

`width` and `height` represent the displayed size in editor content. `naturalWidth` and `naturalHeight` come from the uploaded file where available. `crop` uses normalized percentages from 0 to 100 for `x`, `y`, `width`, and `height`. This keeps saved JSON independent from later image metadata corrections and must be used consistently across editor, serializer, and public renderer.

## Editor UX

`ImageBlockView` renders the image as a block-level React NodeView.

When the image is hovered or selected, a compact Ant Design toolbar appears outside the image, above the top edge. It is local to the image node and is not added to the existing editor floating toolbar or the global toolbar.

Toolbar behavior:

- Shows when pointer enters the image or toolbar.
- Remains visible while the image is selected/focused.
- Hides after a 120-180ms debounce when pointer leaves both image and toolbar.
- Avoids flicker when moving the pointer from image to toolbar.
- Uses Ant Design components such as `Button`, `Tooltip`, `Dropdown`, `Popover`, `Input`, `InputNumber`, and `Select`.

Toolbar controls:

- Replace/upload image.
- Crop.
- Width and height.
- Link.
- Description.
- Alignment.
- Style/parameters.
- View image.
- Delete.
- More menu for lower-frequency actions such as copy.

Selection behavior:

- A selected image shows a blue outline and resize handles on corners and sides.
- Dragging corner handles resizes proportionally by default.
- Width and height precision editing is available from the toolbar popover.
- Delete removes the `imageBlock` node, not the uploaded file record.
- Copy duplicates the node JSON and reuses the same `imageId`.

Preview behavior:

- Use a mature image preview library rather than hand-rolling a lightbox.
- Required controls are previous/next, zoom in/out, fullscreen, and close.
- The preview image list is collected from `imageBlock` nodes in the current editor document.

## Insert And Paste Flow

Toolbar upload:

1. User clicks the image button in the existing editor toolbar.
2. Frontend opens a file picker accepting image MIME types.
3. Frontend uploads `workspaceId + file` to `POST /api/v1/images/upload`.
4. On success, frontend inserts an `imageBlock` at the current selection.

Paste:

1. Paste handler checks `ClipboardEvent.clipboardData.items` for image files before HTML/Markdown handling.
2. If image files are present, prevent default paste behavior.
3. Upload each image through the same image upload service.
4. Insert one `imageBlock` per uploaded file.

Remote images inside pasted HTML are not auto-transferred in the first version. This avoids SSRF and background-fetch risk. They may remain as normal pasted content only if accepted by the existing paste behavior and schema. A later version can add an explicit "transfer remote image" command with backend allowlist and size limits.

## Frontend Services

Add an image service, for example `src/services/images.ts`, with multipart upload support. The existing JSON `api-client` should not be reused directly for `FormData` requests because it always sets `Content-Type: application/json`.

The multipart helper should:

- Attach `Authorization: Bearer <token>`.
- Avoid setting `Content-Type`; the browser must set the multipart boundary.
- Reuse the token refresh strategy or share a lower-level request helper with `api-client`.
- Return a typed image upload response.

The editor context already exposes `workspaceId`, so upload calls should receive `workspaceId` from the current document/editor page context and pass it into the editor or image upload command in a narrow way.

## Backend API

Add a dedicated `ImagesModule` under `src/modules/images`.

Initial endpoints:

```txt
POST /api/v1/images/upload
GET  /api/v1/images/:imageId/file
GET  /api/v1/public/images/:imageId/file
```

`POST /images/upload`:

- Requires authentication.
- Accepts `multipart/form-data` with `workspaceId` and `file`.
- Checks workspace access.
- Allows image MIME types only.
- Applies `IMAGE_MAX_FILE_SIZE` if configured, otherwise `MAX_FILE_SIZE`.
- Stores the file locally using the existing upload directory conventions.
- Persists through `Asset` or a compatible image-specific entity design.
- Returns `imageId`, `url`, `publicUrl`, filename, MIME type, size, width, height, and created time.

`GET /images/:imageId/file`:

- Requires authentication.
- Checks workspace access through the stored image/asset workspace.
- Streams the image inline.

`GET /public/images/:imageId/file`:

- Uses the same public access assumptions as the existing public document content flow.
- The current requirement is to rely on the existing origin validation strategy and not introduce signed URLs yet.
- Streams active image files inline.

The implementation may reuse the existing `Asset` table by storing image uploads as active assets with image MIME type and dimensions. The public API should expose `imageId` as the stable identifier even if it maps to `assetId` internally.

## Rendering And Serialization

Frontend editor extensions:

- Add `imageBlock` to `MarkdownEditor.tsx`.
- Add `imageBlock` to `src/services/tiptap-extensions.ts`.
- Add `imageBlock` to sync identity node types so it receives `clientId` and block identity.
- Add `imageBlock` to Tiptap-to-block type conversion.

Backend serialization:

- Add matching `imageBlock` support in `src/modules/documents/services/tiptap-serialization.extensions.ts`.
- Render to safe HTML such as:

```html
<figure data-image-block data-align="center">
  <a href="..." target="_blank" rel="noopener noreferrer">
    <img src="..." alt="..." width="..." height="..." />
  </a>
</figure>
```

Crop and rotation should be rendered using a constrained wrapper and safe CSS. Sanitization must allow only the required tags, attributes, and CSS properties. Public rendering should output public image URLs for published documents.

## Security

Backend upload validation:

- Reject non-image MIME types.
- Verify file extension is not trusted as the only signal.
- Keep size limits.
- Sanitize stored filenames.
- Do not fetch remote pasted image URLs in this version.

HTML rendering:

- Sanitize `href`, `target`, and `rel`.
- Only allow `http`, `https`, `mailto`, and `tel` for links.
- Do not allow `javascript:` or `data:` links.
- Restrict style properties used for image layout, crop, and rotation.
- Escape `alt`, title, and description text through normal renderer behavior.

The first version allows PNG, JPEG, WebP, and GIF only. SVG is excluded because safe SVG serving needs separate hardening and is not required for the first image editing workflow.

## Testing

Frontend tests:

- `imageBlock` parses and renders expected JSON attributes.
- Toolbar upload inserts an `imageBlock`.
- Paste handler uploads pasted image files before HTML/Markdown paste logic.
- Image attribute commands update only the selected image node.
- Serialization includes image HTML with alt, size, align, link target, crop, and rotation.

Backend tests:

- Upload rejects non-image files.
- Upload requires workspace access.
- Upload returns image metadata and dimensions when available.
- Private file endpoint enforces workspace access.
- Public file endpoint streams active image files through the public route.
- Document HTML renderer allows image block output but strips unsafe attributes and styles.

Manual verification:

- Upload from toolbar.
- Paste a screenshot from clipboard.
- Resize with handles.
- Edit width/height, rotate, crop, link, description, and alignment.
- Copy and delete image nodes.
- Preview with next/previous, zoom, fullscreen, and close.
- Save, reload, and publish a document containing images.

## Deferred Work

- Destructive server-side crop or rotate that creates new image files.
- Thumbnail generation.
- Image reference counting and garbage collection.
- Remote image transfer.
- Signed public image URLs.
- Advanced image gallery management.
