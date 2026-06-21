interface NodeViewUpdateInput {
  oldNode: unknown;
  newNode: unknown;
  oldDecorations: unknown;
  newDecorations: unknown;
  oldInnerDecorations: unknown;
  innerDecorations: unknown;
  updateProps: () => void;
}

/** Keep Tiptap's node view instance while avoiding React work for position-only shifts. */
export function skipPositionOnlyNodeViewUpdate({
  oldNode,
  newNode,
  oldDecorations,
  newDecorations,
  oldInnerDecorations,
  innerDecorations,
  updateProps,
}: NodeViewUpdateInput): boolean {
  if (
    oldNode !== newNode ||
    oldDecorations !== newDecorations ||
    oldInnerDecorations !== innerDecorations
  ) {
    updateProps();
  }

  return true;
}
