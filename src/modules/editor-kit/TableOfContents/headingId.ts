interface HeadingIdCandidate {
  anchorId?: string | null;
  fallbackId: string;
}

export function resolveHeadingId({ anchorId, fallbackId }: HeadingIdCandidate): string {
  const normalizedAnchorId = anchorId?.trim();
  return normalizedAnchorId || fallbackId;
}

export function resolveHeadingElementId(
  element: Element,
  fallbackId: string,
): string {
  const dataAnchor = element.getAttribute("data-anchor");
  const id = element.getAttribute("id");
  return resolveHeadingId({
    anchorId: dataAnchor || id,
    fallbackId,
  });
}
