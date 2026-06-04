// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getClipboardImageFiles, isCodeBlockSelection } from "./pasteHandler";

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

  it("extracts image files from clipboard data items", () => {
    const image = new File(["x"], "shot.png", { type: "image/png" });
    const text = new File(["x"], "note.txt", { type: "text/plain" });
    const data = {
      items: [
        { kind: "file", type: "image/png", getAsFile: () => image },
        { kind: "file", type: "text/plain", getAsFile: () => text },
        { kind: "string", type: "text/plain", getAsFile: () => null },
      ],
    } as unknown as DataTransfer;

    expect(getClipboardImageFiles(data)).toEqual([image]);
  });
});
