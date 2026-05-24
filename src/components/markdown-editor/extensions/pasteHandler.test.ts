import { describe, expect, it } from "vitest";
import { isCodeBlockSelection } from "./pasteHandler";

describe("pasteHandler", () => {
  it("detects selections inside code blocks", () => {
    const view = {
      state: {
        selection: {
          $from: {
            parent: {
              type: {
                name: "codeBlock",
              },
            },
          },
        },
      },
    };

    expect(isCodeBlockSelection(view)).toBe(true);
  });

  it("does not treat normal paragraphs as code block selections", () => {
    const view = {
      state: {
        selection: {
          $from: {
            parent: {
              type: {
                name: "paragraph",
              },
            },
          },
        },
      },
    };

    expect(isCodeBlockSelection(view)).toBe(false);
  });
});
