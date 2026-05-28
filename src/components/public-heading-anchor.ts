export const PUBLIC_HEADING_SCROLL_OFFSET = 76;

export function readPublicHeadingLabel(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelector(".doc-heading-anchor")?.remove();
  return clone.textContent?.trim() || "";
}

export function resolvePublicHeadingHash(heading: HTMLElement, fallbackIndex: number): string {
  const existingId = heading.getAttribute("id")?.trim();
  if (existingId) return existingId;

  const text = readPublicHeadingLabel(heading);
  if (text) return text;

  return `heading-${fallbackIndex}`;
}

export function scrollToPublicHeadingHash(hash: string, offset = PUBLIC_HEADING_SCROLL_OFFSET): boolean {
  const target = document.getElementById(hash);
  if (!target) return false;

  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
  return true;
}

export function updatePublicHeadingHash(hash: string): string {
  const url = new URL(window.location.href);
  url.hash = hash;
  const nextUrl = url.toString();
  window.history.replaceState(null, "", nextUrl);
  return nextUrl;
}

export function enhancePublicHeadingAnchors(
  root: ParentNode = document,
  offset = PUBLIC_HEADING_SCROLL_OFFSET,
): number {
  const headings = Array.from(
    root.querySelectorAll<HTMLElement>(".doc-content h1, .doc-content h2, .doc-content h3, .doc-content h4, .doc-content h5, .doc-content h6"),
  );

  headings.forEach((heading, index) => {
    const hash = resolvePublicHeadingHash(heading, index);
    if (heading.id !== hash) {
      heading.id = hash;
    }

    heading.classList.add("doc-heading-with-anchor");

    const label = readPublicHeadingLabel(heading) || "该标题";
    const existingAnchor = heading.querySelector<HTMLAnchorElement>(":scope > .doc-heading-anchor");
    if (existingAnchor) {
      existingAnchor.href = `#${hash}`;
      existingAnchor.setAttribute("aria-label", `复制并定位到 ${label}`);
      return;
    }

    const anchor = document.createElement("a");
    anchor.className = "doc-heading-anchor";
    anchor.href = `#${hash}`;
    anchor.textContent = "#";
    anchor.setAttribute("aria-label", `复制并定位到 ${label}`);
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      updatePublicHeadingHash(hash);
      scrollToPublicHeadingHash(hash, offset);
    });

    heading.prepend(anchor);
  });

  return headings.length;
}
