# Public Document Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache public document detail pages by default and allow explicit fresh backend reads through `/blog/:slug/latest`.

**Architecture:** Keep the existing `/blog/:slug -> /doc/:slug` rewrite and add a more specific `/blog/:slug/latest -> /doc/:slug?latest=1` rewrite. `app/doc/[slug]/page.tsx` derives a `latest` boolean from `searchParams` and uses one fetch policy helper for metadata, content, document meta, and tags.

**Tech Stack:** Next.js App Router, React Server Components, TypeScript, Vitest source-contract tests.

---

## File Structure

- Modify `next.config.ts`: add the `/blog/:slug/latest` rewrite before the generic `/blog/:slug` rewrite.
- Modify `app/doc/[slug]/page.tsx`: add `searchParams`, a public fetch policy helper, and pass the latest/default policy to every public document fetch.
- Modify `src/services/__tests__/doc-page-ssr-rendering.test.ts`: add source-contract tests for the rewrite order and page cache policy.

---

### Task 1: Add Tests For Public Cache Contract

**Files:**
- Modify: `src/services/__tests__/doc-page-ssr-rendering.test.ts`

- [ ] **Step 1: Add failing tests for route and fetch policy**

Append these tests inside the existing `describe("doc page SSR rendering contract", () => { ... })` block in `src/services/__tests__/doc-page-ssr-rendering.test.ts`:

```ts
  it("routes latest public document requests before the generic blog slug rewrite", () => {
    const configSource = fs.readFileSync(
      path.resolve(process.cwd(), "next.config.ts"),
      "utf8",
    );

    const latestRewriteIndex = configSource.indexOf("source: `${DOC_PATH}/:slug/latest`");
    const genericRewriteIndex = configSource.indexOf("source: `${DOC_PATH}/:slug`");

    expect(latestRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(genericRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(latestRewriteIndex).toBeLessThan(genericRewriteIndex);
    expect(configSource).toContain('destination: `/doc/:slug?latest=1`');
  });

  it("uses cached public fetches by default and no-store for latest requests", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("const PUBLIC_DOC_REVALIDATE_SECONDS = 3600");
    expect(pageSource).toContain("function publicFetchOptions(latest: boolean): RequestInit");
    expect(pageSource).toContain('latest ? { cache: "no-store" }');
    expect(pageSource).toContain("next: { revalidate: PUBLIC_DOC_REVALIDATE_SECONDS }");
    expect(pageSource).toContain("function isLatestRequest(");
    expect(pageSource).toContain("getDocMetadata(slug, latest)");
    expect(pageSource).toContain("getDocContent(slug, latest)");
  });

  it("does not hardcode no-store on every public document backend fetch", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    const noStoreMatches = pageSource.match(/cache: "no-store"/g) ?? [];
    expect(noStoreMatches).toHaveLength(1);
    expect(pageSource).not.toContain('{ cache: "no-store" }');
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

Expected: FAIL. The new tests should fail because `next.config.ts` does not yet contain the `/latest` rewrite and `app/doc/[slug]/page.tsx` still hardcodes multiple `{ cache: "no-store" }` fetch options.

- [ ] **Step 3: Commit the failing tests**

Run:

```bash
git add src/services/__tests__/doc-page-ssr-rendering.test.ts
git commit -m "test: cover public doc cache contract"
```

Expected: commit succeeds with only the test file staged.

---

### Task 2: Add The `/latest` Rewrite

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Update the rewrite list**

In `next.config.ts`, replace the current `rewrites()` return array with this version:

```ts
  async rewrites() {
    return [
      {
        source: `${DOC_PATH}/:slug/latest`,
        destination: `/doc/:slug?latest=1`,
      },
      {
        source: `${DOC_PATH}/:slug`,
        destination: `/doc/:slug`,
      },
    ];
  },
```

- [ ] **Step 2: Run the focused test and verify only page cache tests still fail**

Run:

```bash
pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

Expected: FAIL. The rewrite-order test should now pass. The page cache policy tests should still fail because `app/doc/[slug]/page.tsx` has not been changed.

- [ ] **Step 3: Commit the rewrite change**

Run:

```bash
git add next.config.ts
git commit -m "feat: route latest public doc requests"
```

Expected: commit succeeds with only `next.config.ts` staged.

---

### Task 3: Implement Public Fetch Cache Policy

**Files:**
- Modify: `app/doc/[slug]/page.tsx`

- [ ] **Step 1: Add constants, helper types, and fetch policy helpers**

Near the existing `API_BASE` constant in `app/doc/[slug]/page.tsx`, add:

```ts
const PUBLIC_DOC_REVALIDATE_SECONDS = 3600;

type PublicDocSearchParams = {
  latest?: string | string[];
};

function isLatestRequest(searchParams?: PublicDocSearchParams): boolean {
  const value = searchParams?.latest;
  return Array.isArray(value) ? value.includes("1") : value === "1";
}

function publicFetchOptions(latest: boolean): RequestInit {
  return latest
    ? { cache: "no-store" }
    : { next: { revalidate: PUBLIC_DOC_REVALIDATE_SECONDS } };
}
```

- [ ] **Step 2: Pass cache policy into metadata fetch**

Change:

```ts
async function getDocMetadata(slug: string): Promise<{ title: string } | null> {
```

to:

```ts
async function getDocMetadata(
  slug: string,
  latest: boolean,
): Promise<{ title: string } | null> {
```

Then change:

```ts
  const docRes = await fetch(`${API_BASE}/documents/${docId}`, { cache: "no-store" });
```

to:

```ts
  const docRes = await fetch(
    `${API_BASE}/documents/${docId}`,
    publicFetchOptions(latest),
  );
```

- [ ] **Step 3: Pass cache policy into content, document meta, and tags fetches**

Change:

```ts
async function getDocContent(slug: string) {
```

to:

```ts
async function getDocContent(slug: string, latest: boolean) {
```

Then change the `Promise.all` fetches from:

```ts
  const [contentRes, docRes] = await Promise.all([
    fetch(`${API_BASE}/documents/${docId}/content?mode=all`, { cache: "no-store" }),
    fetch(`${API_BASE}/documents/${docId}`, { cache: "no-store" }),
  ]);
```

to:

```ts
  const fetchOptions = publicFetchOptions(latest);
  const [contentRes, docRes] = await Promise.all([
    fetch(`${API_BASE}/documents/${docId}/content?mode=all`, fetchOptions),
    fetch(`${API_BASE}/documents/${docId}`, fetchOptions),
  ]);
```

Change the tags fetch from:

```ts
      const tagsRes = await fetch(`${API_BASE}/tags?workspaceId=${docData.workspaceId}&pageSize=100`, { cache: "no-store" });
```

to:

```ts
      const tagsRes = await fetch(
        `${API_BASE}/tags?workspaceId=${docData.workspaceId}&pageSize=100`,
        publicFetchOptions(latest),
      );
```

- [ ] **Step 4: Add `searchParams` to page props and generate metadata**

Replace the current `PageProps` type:

```ts
type PageProps = {
  params: Promise<{ slug: string }>;
};
```

with:

```ts
type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<PublicDocSearchParams>;
};
```

Replace `generateMetadata` with:

```ts
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const latest = isLatestRequest(await searchParams);
  const doc = await getDocMetadata(slug, latest);
  return { title: doc?.title || "文档不存在" };
}
```

Replace the start of `DocPage`:

```ts
export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = await getDocContent(slug);
```

with:

```ts
export default async function DocPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const latest = isLatestRequest(await searchParams);
  const doc = await getDocContent(slug, latest);
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

Expected: PASS. All public document SSR contract tests should pass.

- [ ] **Step 6: Commit the page cache policy**

Run:

```bash
git add app/doc/[slug]/page.tsx src/services/__tests__/doc-page-ssr-rendering.test.ts
git commit -m "feat: cache public doc fetches by default"
```

Expected: commit succeeds with the page and test file staged.

---

### Task 4: Final Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run the focused public document test**

Run:

```bash
pnpm vitest run src/services/__tests__/doc-page-ssr-rendering.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full unit test suite**

Run:

```bash
pnpm test:unit
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm build
```

Expected: PASS. The build should complete without TypeScript or Next.js route type errors.

- [ ] **Step 4: Inspect final git status**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing files should remain, such as `?? 2026-05-23-111756-this-session-is-being-continued-from-a-previous-c.txt`.

---

## Self-Review

Spec coverage:

- Default cached public document reads are covered by Task 3.
- `/blog/:slug/latest` fresh reads are covered by Task 2 and Task 3.
- Metadata, content, document meta, and tag metadata fetches are covered by Task 3.
- Backend APIs remain unchanged.
- Existing SSR rendering is preserved because the plan only changes fetch options and route search params.

Placeholder scan:

- The plan contains concrete file paths, code snippets, commands, and expected results.
- No unspecified validation or open implementation steps remain.

Type consistency:

- `PublicDocSearchParams` is defined before use.
- `PageProps.searchParams` uses `Promise<PublicDocSearchParams>` consistently in both `generateMetadata` and `DocPage`.
- `getDocMetadata(slug, latest)` and `getDocContent(slug, latest)` are introduced before call sites are changed.
