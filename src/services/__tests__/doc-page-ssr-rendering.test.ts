import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderBlockTreeToHtml } from "../generate-block-html";

describe("doc page SSR rendering contract", () => {
  it("server page should not depend on jsdom-based runtime sanitizers/renderers", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).not.toContain('from "isomorphic-dompurify"');
  });

  it("server page should request mixed html/json content from the backend", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("getPublicDocSnapshot");
    expect(pageSource).toContain("isLatestRequest");
  });

  it("metadata generation should not warm the html render cache", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );
    const metadataSource = pageSource.slice(
      pageSource.indexOf("export async function generateMetadata"),
      pageSource.indexOf("export default async function DocPage"),
    );

    expect(metadataSource).not.toContain("/content?mode=all");
    expect(metadataSource).toContain("generateMetadata");
    expect(metadataSource).toContain("getPublicDocSnapshot(slug, latest)");
  });

  it("server page delegates code highlighting to the browser", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );
    const deferredRendererSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DeferredCodeBlockRenderer.tsx"),
      "utf8",
    );

    expect(pageSource).not.toContain("highlightCodeBlocks");
    expect(pageSource).toContain("DeferredCodeBlockRenderer");
    expect(deferredRendererSource).toContain("ClientCodeBlockRenderer");
    expect(deferredRendererSource).toContain('ssr: false');
  });

  it("routes latest public document requests before the generic blog slug rewrite", () => {
    const configSource = fs.readFileSync(
      path.resolve(process.cwd(), "next.config.ts"),
      "utf8",
    );

    const latestRewriteIndex = configSource.indexOf(
      "source: `${DOC_PATH}/:slug/latest`",
    );
    const genericRewriteIndex = configSource.indexOf(
      "source: `${DOC_PATH}/:slug`",
    );

    expect(latestRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(genericRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(latestRewriteIndex).toBeLessThan(genericRewriteIndex);
    expect(configSource).toContain("destination: `/doc/:slug?latest=1`");
  });

  it("uses cached public fetches by default and no-store for latest requests", () => {
    const snapshotSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/public-doc-snapshot.ts"),
      "utf8",
    );

    expect(snapshotSource).toContain(
      "const PUBLIC_DOC_REVALIDATE_SECONDS = 3600",
    );
    expect(snapshotSource).toContain("unstable_cache");
    expect(snapshotSource).toContain("cache(async (slug: string, latest: boolean)");
    expect(snapshotSource).toContain('latest ? readPublicDocSnapshot(slug, true)');
    expect(snapshotSource).toContain("getCachedPublicDocSnapshot(slug)");
    expect(snapshotSource).toContain('cache: "no-store"');
    expect(snapshotSource).toContain("revalidate: PUBLIC_DOC_REVALIDATE_SECONDS");
    expect(snapshotSource).toContain("tags: [getPublicDocCacheTag(slug)]");
  });

  it("uses one unified public doc snapshot for metadata and page rendering", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/page.tsx"),
      "utf8",
    );

    expect(pageSource).toContain('from "@/services/public-doc-snapshot"');
    const snapshotCalls =
      pageSource.match(/getPublicDocSnapshot\(slug, latest\)/g) ?? [];
    expect(snapshotCalls).toHaveLength(2);
  });


  it("exposes a protected revalidate endpoint for published public docs", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/api/revalidate-doc/route.ts"),
      "utf8",
    );

    expect(routeSource).toContain('process.env.REVALIDATE_SECRET');
    expect(routeSource).toContain('request.headers.get("x-revalidate-secret")');
    expect(routeSource).toContain("revalidateTag");
    expect(routeSource).toContain("getPublicDocCacheTag(slug)");
    expect(routeSource).toContain('revalidatePath(`/doc/${slug}`)');
  });

  it("renders common block payloads into html fragments", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "p1",
          type: "paragraph",
          sortKey: "001000",
          payload: {
            type: "paragraph",
            attrs: { textAlign: null, lineHeight: null, indent: 0 },
            content: [{ type: "text", text: "Hello SSR" }],
          },
          children: [],
        },
        {
          blockId: "l1",
          type: "bulletList",
          sortKey: "002000",
          payload: {
            type: "bulletList",
            attrs: {},
            content: [
              {
                type: "listItem",
                attrs: {},
                content: [
                  {
                    type: "paragraph",
                    attrs: { textAlign: null, lineHeight: null, indent: 0 },
                    content: [{ type: "text", text: "Item one" }],
                  },
                ],
              },
            ],
          },
          children: [],
        },
        {
          blockId: "h1",
          type: "highlightBlock",
          sortKey: "003000",
          payload: {
            type: "highlightBlock",
            attrs: { backgroundColor: "#FFF2CC" },
            content: [
              {
                type: "paragraph",
                attrs: { textAlign: null, lineHeight: null, indent: 0 },
                content: [{ type: "text", text: "Highlighted" }],
              },
            ],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain("<p>Hello SSR</p>");
    expect(html).toContain("<ul");
    expect(html).toContain("Item one");
    expect(html).toContain('data-highlight-block=""');
    expect(html).toContain("Highlighted");
  });

  it("rewrites cached image html to backend urls", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "img1",
          type: "imageBlock",
          sortKey: "001000",
          html: '<figure data-image-block><img src="/api/v1/images/asset_1/file" alt="photo"></figure>',
          payload: {},
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('src="https://api-zzz.yumgjs.com/api/v1/images/asset_1/file"');
  });

  it("prefers backend block html and falls back to local json rendering per block", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "p1",
          type: "paragraph",
          sortKey: "001000",
          html: '<p data-server-rendered="true">Rendered by backend</p>',
          payload: {
            type: "paragraph",
            content: [{ type: "text", text: "Should not render this JSON" }],
          },
          children: [],
        },
        {
          blockId: "h1",
          type: "heading",
          sortKey: "002000",
          payload: {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Rendered from JSON fallback" }],
          },
          children: [],
        },
        {
          blockId: "code1",
          type: "codeBlock",
          sortKey: "003000",
          payload: {
            type: "codeBlock",
            attrs: { language: "ts" },
            content: [{ type: "text", text: "const answer = 42;" }],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain("Rendered by backend");
    expect(html).not.toContain("Should not render this JSON");
    expect(html).toContain("<h2>Rendered from JSON fallback</h2>");
    expect(html).toContain('data-code-block-placeholder="true"');
    expect(html).toContain('data-language="typescript"');
    expect(html).toContain("const answer = 42;");
  });

  it("emits placeholders for code blocks even when backend html is present", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "code1",
          type: "codeBlock",
          sortKey: "001000",
          html: "<pre><code>server highlighted</code></pre>",
          payload: {
            type: "codeBlock",
            attrs: { language: "javascript", title: "Demo" },
            content: [{ type: "text", text: "console.log(1);" }],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('data-code-block-placeholder="true"');
    expect(html).toContain('data-title="Demo"');
    expect(html).toContain("console.log(1);");
    expect(html).not.toContain("server highlighted");
  });

  it("keeps public code block placeholders visually empty before client highlighting", () => {
    const tree = {
      blockId: "root_1",
      type: "root",
      payload: { type: "root", children: [] },
      children: [
        {
          blockId: "code1",
          type: "codeBlock",
          sortKey: "001000",
          payload: {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: "console.log(1);" }],
          },
          children: [],
        },
      ],
    };

    const html = renderBlockTreeToHtml(tree);

    expect(html).toContain('data-code-block-code="console.log(1);"');
    expect(html).not.toContain("<pre><code>console.log(1);</code></pre>");
    expect(html).not.toContain(">console.log(1);<");
  });

  it("renders public code block chrome with fold, title, language label, and copy", () => {
    const rendererSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/ClientCodeBlockRenderer.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const chromeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/markdown-editor/code/publicCodeBlockChrome.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(rendererSource).toContain("renderPublicCodeBlockChrome");
    expect(rendererSource).toContain("bindPublicCodeBlockChrome");
    expect(rendererSource).toContain('classList.toggle("is-status-collapsed"');
    expect(rendererSource).toContain('classList.remove("is-code-collapsed"');
    expect(chromeSource).toContain("code-block-public-fold");
    expect(chromeSource).toContain("code-block-public-copy");
    expect(chromeSource).toContain("is-copied");
  });

  it("defers public document layout settings fetch until after the window load event", () => {
    const layoutSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/DocPageLayout.tsx"),
      "utf8",
    );

    expect(layoutSource).toContain("window.addEventListener(\"load\", start, { once: true })");
    expect(layoutSource).toContain("getClientVisibleSettings(workspaceId)");
  });

  it("provides custom public-facing 404 and error pages", () => {
    const notFoundSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/not-found.tsx"),
      "utf8",
    );
    const docNotFoundSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/doc/[slug]/not-found.tsx"),
      "utf8",
    );
    const errorSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/error.tsx"),
      "utf8",
    );

    expect(notFoundSource).toContain("文档不存在");
    expect(docNotFoundSource).toContain("文档不存在");
    expect(errorSource).toContain("console.log");
    expect(errorSource).toContain("error.message");
  });
});
