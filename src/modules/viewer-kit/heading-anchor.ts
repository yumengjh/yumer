const DEFAULT_CONTENT_SELECTOR = ".doc-content";

export const DEFAULT_HEADING_SCROLL_OFFSET = 76;
export const PUBLIC_HEADING_SCROLL_OFFSET = DEFAULT_HEADING_SCROLL_OFFSET;

interface HeadingQueryOptions {
  contentSelector?: string;
}

interface EnhanceHeadingAnchorsOptions extends HeadingQueryOptions {
  offset?: number;
}

function resolveHeadingSelector(contentSelector: string): string {
  return `${contentSelector} h1, ${contentSelector} h2, ${contentSelector} h3, ${contentSelector} h4, ${contentSelector} h5, ${contentSelector} h6`;
}

export function findDocumentHeadings(
  root: ParentNode = document,
  options: HeadingQueryOptions = {},
): HTMLElement[] {
  const contentSelector = options.contentSelector ?? DEFAULT_CONTENT_SELECTOR;
  return Array.from(root.querySelectorAll<HTMLElement>(resolveHeadingSelector(contentSelector)));
}

export function readHeadingLabel(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelector(".doc-heading-anchor")?.remove();
  return clone.textContent?.trim() || "";
}

export function readPublicHeadingLabel(heading: HTMLElement): string {
  return readHeadingLabel(heading);
}

export function resolveHeadingHash(heading: HTMLElement, fallbackIndex: number): string {
  const existingId = heading.getAttribute("id")?.trim();
  if (existingId) return existingId;

  const text = readHeadingLabel(heading);
  if (text) return text;

  return `heading-${fallbackIndex}`;
}

export function resolvePublicHeadingHash(heading: HTMLElement, fallbackIndex: number): string {
  return resolveHeadingHash(heading, fallbackIndex);
}

export function scrollToHeadingHash(
  hash: string,
  offset = DEFAULT_HEADING_SCROLL_OFFSET,
): boolean {
  const target = document.getElementById(hash);
  if (!target) return false;

  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
  return true;
}

export function scrollToPublicHeadingHash(
  hash: string,
  offset = DEFAULT_HEADING_SCROLL_OFFSET,
): boolean {
  return scrollToHeadingHash(hash, offset);
}

export function updateHeadingHash(hash: string): string {
  const url = new URL(window.location.href);
  url.hash = hash;
  const nextUrl = url.toString();
  window.history.replaceState(null, "", nextUrl);
  return nextUrl;
}

export function updatePublicHeadingHash(hash: string): string {
  return updateHeadingHash(hash);
}

export function enhanceHeadingAnchors(
  root: ParentNode = document,
  options: EnhanceHeadingAnchorsOptions = {},
): number {
  const offset = options.offset ?? DEFAULT_HEADING_SCROLL_OFFSET;
  const headings = findDocumentHeadings(root, options);

  headings.forEach((heading, index) => {
    const hash = resolveHeadingHash(heading, index);
    if (heading.id !== hash) {
      heading.id = hash;
    }

    heading.classList.add("doc-heading-with-anchor");

    const label = readHeadingLabel(heading) || "Untitled heading";
    const existingAnchor = heading.querySelector<HTMLAnchorElement>(":scope > .doc-heading-anchor");
    if (existingAnchor) {
      existingAnchor.href = `#${hash}`;
      existingAnchor.setAttribute("aria-label", `Copy and jump to ${label}`);
      return;
    }

    const anchor = document.createElement("a");
    anchor.className = "doc-heading-anchor";
    anchor.href = `#${hash}`;
    anchor.textContent = "#";
    anchor.setAttribute("aria-label", `Copy and jump to ${label}`);
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      updateHeadingHash(hash);
      scrollToHeadingHash(hash, offset);
    });

    heading.prepend(anchor);
  });

  return headings.length;
}

export function enhancePublicHeadingAnchors(
  root: ParentNode = document,
  offset = DEFAULT_HEADING_SCROLL_OFFSET,
): number {
  return enhanceHeadingAnchors(root, { offset });
}
