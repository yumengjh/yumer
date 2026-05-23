import { describe, expect, it } from "vitest";
import { encodeDocId } from "@/lib/doc-slug";
import { resolveEditorRouteHydration } from "./editorRouteHydration";

describe("resolveEditorRouteHydration", () => {
  it("ignores stale document-state rerenders while the pathname has not changed yet", () => {
    expect(
      resolveEditorRouteHydration({
        authLoading: false,
        isAuthenticated: true,
        workspaceId: "ws-1",
        pathname: "/dash/edit/doc-a",
        currentDocSlug: "doc-b",
        hydratingSlug: null,
        lastPathname: "/dash/edit/doc-a",
      }),
    ).toEqual({ type: "noop", nextPathname: "/dash/edit/doc-a" });
  });

  it("does not consume the refresh pathname before auth/workspace recovery finishes", () => {
    expect(
      resolveEditorRouteHydration({
        authLoading: true,
        isAuthenticated: false,
        workspaceId: null,
        pathname: "/dash/edit/doc-a",
        currentDocSlug: null,
        hydratingSlug: null,
        lastPathname: null,
      }),
    ).toEqual({ type: "noop", nextPathname: null });

    const nextDocId = "doc_1777597341536_714ae45b";
    const nextSlug = encodeDocId(nextDocId);

    expect(
      resolveEditorRouteHydration({
        authLoading: false,
        isAuthenticated: true,
        workspaceId: "ws-1",
        pathname: `/dash/edit/${nextSlug}`,
        currentDocSlug: null,
        hydratingSlug: null,
        lastPathname: null,
      }),
    ).toEqual({
      type: "hydrate",
      slug: nextSlug,
      docId: nextDocId,
      nextPathname: `/dash/edit/${nextSlug}`,
    });
  });

  it("hydrates the pathname target after a real route change", () => {
    const nextDocId = "doc_1777597341536_714ae45b";
    const nextSlug = encodeDocId(nextDocId);
    const currentSlug = encodeDocId("doc_1777597341536_714ae45a");

    expect(
      resolveEditorRouteHydration({
        authLoading: false,
        isAuthenticated: true,
        workspaceId: "ws-1",
        pathname: `/dash/edit/${nextSlug}`,
        currentDocSlug: currentSlug,
        hydratingSlug: null,
        lastPathname: "/dash/edit/other-doc",
      }),
    ).toEqual({
      type: "hydrate",
      slug: nextSlug,
      docId: nextDocId,
      nextPathname: `/dash/edit/${nextSlug}`,
    });
  });

  it("redirects to dash when the editor pathname is missing a slug", () => {
    expect(
      resolveEditorRouteHydration({
        authLoading: false,
        isAuthenticated: true,
        workspaceId: "ws-1",
        pathname: "/dash/edit/",
        currentDocSlug: null,
        hydratingSlug: null,
        lastPathname: null,
      }),
    ).toEqual({ type: "redirect", href: "/dash", nextPathname: "/dash/edit/" });
  });
});
