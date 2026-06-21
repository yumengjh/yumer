import { describe, expect, it, vi } from "vitest";
import { skipPositionOnlyNodeViewUpdate } from "./nodeViewUpdate";

describe("skipPositionOnlyNodeViewUpdate", () => {
  it("does not rerender a React node view when only its document position changed", () => {
    const node = {};
    const decorations: unknown[] = [];
    const innerDecorations = {};
    const updateProps = vi.fn();

    const accepted = skipPositionOnlyNodeViewUpdate({
      oldNode: node,
      newNode: node,
      oldDecorations: decorations,
      newDecorations: decorations,
      oldInnerDecorations: innerDecorations,
      innerDecorations,
      updateProps,
    });

    expect(accepted).toBe(true);
    expect(updateProps).not.toHaveBeenCalled();
  });

  it("rerenders when node content or decorations changed", () => {
    const node = {};
    const decorations: unknown[] = [];
    const innerDecorations = {};

    for (const overrides of [
      { newNode: {} },
      { newDecorations: [] },
      { innerDecorations: {} },
    ]) {
      const updateProps = vi.fn();
      skipPositionOnlyNodeViewUpdate({
        oldNode: node,
        newNode: node,
        oldDecorations: decorations,
        newDecorations: decorations,
        oldInnerDecorations: innerDecorations,
        innerDecorations,
        updateProps,
        ...overrides,
      });
      expect(updateProps).toHaveBeenCalledOnce();
    }
  });
});
