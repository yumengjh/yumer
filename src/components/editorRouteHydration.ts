import { DASH_EDIT_PATH, DASH_PATH } from "@/contexts/DocumentContext";
import { decodeDocSlug } from "@/lib/doc-slug";

type ResolveEditorRouteHydrationInput = {
  authLoading: boolean;
  isAuthenticated: boolean;
  workspaceId: string | null;
  pathname: string;
  currentDocSlug: string | null;
  hydratingSlug: string | null;
  lastPathname: string | null;
};

type EditorRouteHydrationAction =
  | { type: "noop"; nextPathname: string | null }
  | { type: "settled"; nextPathname: string }
  | { type: "redirect"; href: string; nextPathname: string }
  | { type: "invalid"; nextPathname: string }
  | { type: "hydrate"; slug: string; docId: string; nextPathname: string };

export function resolveEditorRouteHydration({
  authLoading,
  isAuthenticated,
  workspaceId,
  pathname,
  currentDocSlug,
  hydratingSlug,
  lastPathname,
}: ResolveEditorRouteHydrationInput): EditorRouteHydrationAction {
  if (authLoading || !isAuthenticated || !workspaceId) {
    return { type: "noop", nextPathname: lastPathname };
  }

  if (!pathname.startsWith(`${DASH_EDIT_PATH}/`)) {
    return { type: "noop", nextPathname: lastPathname };
  }

  const pathnameChanged = lastPathname === null || lastPathname !== pathname;
  if (!pathnameChanged) {
    return { type: "noop", nextPathname: pathname };
  }

  const slug = pathname.slice(DASH_EDIT_PATH.length + 1);
  if (!slug) {
    return { type: "redirect", href: DASH_PATH, nextPathname: pathname };
  }

  if (currentDocSlug === slug) {
    return { type: "settled", nextPathname: pathname };
  }

  if (hydratingSlug === slug) {
    return { type: "noop", nextPathname: pathname };
  }

  try {
    return {
      type: "hydrate",
      slug,
      docId: decodeDocSlug(slug),
      nextPathname: pathname,
    };
  } catch {
    return { type: "invalid", nextPathname: pathname };
  }
}
