# Public Document Cache Design

## Goal

Add caching to the public document detail page served as `/blog/:slug` so normal reads do not request the backend on every page load. A caller can explicitly request the freshest backend data by visiting `/blog/:slug/latest`.

This design applies to the current Next.js public document route:

- Public URL: `/blog/:slug`
- Existing rewrite target: `/doc/:slug`
- Page implementation: `app/doc/[slug]/page.tsx`

## Scope

In scope:

- Cache public document detail data by default.
- Add `/blog/:slug/latest` as an explicit fresh-read URL.
- Keep SSR output and the existing public document rendering pipeline.
- Keep current backend APIs unchanged.
- Cover document content, document metadata, and tag metadata fetches.

Out of scope:

- Backend cache or database schema changes.
- Publish-time HTML snapshot storage.
- Immediate cache invalidation after editing or publishing.
- Replacing the existing `/content?mode=all` rendering contract.

## Route Behavior

`next.config.ts` should define two public document rewrites:

```txt
/blog/:slug/latest -> /doc/:slug?latest=1
/blog/:slug        -> /doc/:slug
```

The `/latest` rewrite must be listed before the generic `/blog/:slug` rewrite so it is matched first.

`app/doc/[slug]/page.tsx` should accept `searchParams` and derive:

```ts
const latest = searchParams.latest === "1";
```

The page keeps rendering exactly the same UI. The `latest` flag only controls fetch caching.

## Fetch Policy

Create a small helper in `app/doc/[slug]/page.tsx`:

```ts
function publicFetchOptions(latest: boolean): RequestInit {
  return latest ? { cache: "no-store" } : { next: { revalidate: 3600 } };
}
```

Default route behavior:

- `/blog/:slug` uses `next: { revalidate: 3600 }`.
- Next.js may serve cached backend fetch responses during the revalidation window.
- The backend is not requested on every page load.

Fresh route behavior:

- `/blog/:slug/latest` uses `cache: "no-store"`.
- Every request goes to the backend.
- This route is for manual freshness checks, preview links, and debugging stale public content.

## Affected Requests

The helper should be applied consistently to:

- `GET /documents/:docId/content?mode=all`
- `GET /documents/:docId`
- `GET /tags?workspaceId=...&pageSize=100`
- the metadata request used by `generateMetadata`

`generateMetadata` should also receive `searchParams` so `/blog/:slug/latest` does not accidentally keep using cached metadata while the page body is fresh.

## Data Flow

Normal request:

```txt
browser -> /blog/:slug
Next rewrite -> /doc/:slug
DocPage latest=false
fetch content/meta/tags with revalidate=3600
render SSR HTML
```

Fresh request:

```txt
browser -> /blog/:slug/latest
Next rewrite -> /doc/:slug?latest=1
DocPage latest=true
fetch content/meta/tags with no-store
render SSR HTML
```

The fresh request does not need to update or purge the default cached result. If publication-time invalidation becomes necessary later, add tag-based revalidation as a separate feature.

## Error Handling

The current fallback behavior remains:

- Invalid slug returns `null` and the page calls `notFound()`.
- Failed content or metadata requests return `null`.
- Failed tag requests are ignored and the document still renders without tag names.

The cache mode should not change error semantics.

## Testing

Add or update unit tests around the public document SSR contract:

- `next.config.ts` contains `/blog/:slug/latest` rewrite before `/blog/:slug`.
- The document page no longer hardcodes `cache: "no-store"` for default public fetches.
- A helper or equivalent branch returns `cache: "no-store"` for `latest=true`.
- The default branch uses `next.revalidate`.
- `generateMetadata` also follows the latest/default fetch policy.

Manual verification:

- Open `/blog/:slug` twice and confirm the second request does not always hit the backend.
- Open `/blog/:slug/latest` and confirm it hits the backend.
- Confirm the document body, metadata, tags, and code block client rendering still appear correctly.

## Tradeoffs

This uses Next.js fetch caching instead of a custom in-memory cache. That keeps the implementation small and compatible with serverless deployments. The tradeoff is that stale content may remain visible until the revalidation window expires.

The first implementation intentionally avoids tag-based invalidation. That keeps the frontend-only change straightforward. If editors need published content to refresh immediately after publish, the next design should add `next: { tags: [...] }` plus a small revalidation endpoint or server action.
