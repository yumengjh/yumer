// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { describe, expect, it } from "vitest";
import { ImageBlock, normalizeImageBlockAttrs } from "./imageBlock";

function createEditor() {
  return new Editor({
    extensions: [Document, Paragraph, Text, ImageBlock],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("ImageBlock", () => {
  it("normalizes missing and invalid attributes", () => {
    expect(
      normalizeImageBlockAttrs({
        imageId: 123,
        src: "/api/v1/images/img_1/file",
        naturalWidth: "640",
        naturalHeight: "bad",
        width: -1,
        height: 320,
        align: "weird",
        rotate: 450,
        crop: { x: -10, y: 20, width: 120, height: 80 },
        styles: ["shadow", "bad", "rounded", "shadow"],
        linkTarget: "_parent",
      }),
    ).toEqual({
      imageId: "",
      src: "/api/v1/images/img_1/file",
      filename: "",
      mimeType: "",
      size: 0,
      naturalWidth: 640,
      naturalHeight: null,
      width: null,
      height: 320,
      alt: "",
      align: "left",
      rotate: 90,
      crop: { x: 0, y: 20, width: 100, height: 80 },
      styles: ["shadow", "rounded"],
      linkHref: "",
      linkTarget: "_self",
    });
  });

  it("inserts an image block with default display attrs", () => {
    const editor = createEditor();

    editor.commands.insertImageBlock({
      imageId: "asset_1",
      src: "/api/v1/images/asset_1/file",
      filename: "photo.png",
      mimeType: "image/png",
      size: 10,
      naturalWidth: 800,
      naturalHeight: 600,
    });

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "imageBlock",
      attrs: {
        imageId: "asset_1",
        src: "/api/v1/images/asset_1/file",
        filename: "photo.png",
        align: "left",
        rotate: 0,
        crop: null,
        styles: [],
        linkTarget: "_self",
      },
    });

    editor.destroy();
  });

  it("renders safe image HTML attributes", () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "imageBlock",
          attrs: {
            imageId: "asset_1",
            src: "/api/v1/public/images/asset_1/file",
            alt: "Sunset",
            width: 640,
            height: 360,
            align: "right",
            rotate: 90,
            styles: ["shadow", "border", "rounded"],
            linkHref: "https://example.com",
            linkTarget: "_blank",
          },
        },
      ],
    });

    expect(editor.getHTML()).toContain('data-image-block=""');
    expect(editor.getHTML()).toContain('data-align="right"');
    expect(editor.getHTML()).toContain('src="/api/v1/public/images/asset_1/file"');
    expect(editor.getHTML()).toContain('alt="Sunset"');
    expect(editor.getHTML()).toContain("width: 360px");
    expect(editor.getHTML()).toContain("aspect-ratio: 360/640");
    expect(editor.getHTML()).toContain("rotate(90deg)");
    expect(editor.getHTML()).toContain("image-crop-window--shadow");
    expect(editor.getHTML()).toContain("image-crop-window--border");
    expect(editor.getHTML()).toContain("image-crop-window--rounded");
    expect(editor.getHTML()).toContain('data-styles="[&quot;shadow&quot;,&quot;border&quot;,&quot;rounded&quot;]"');
    expect(editor.getHTML()).toContain('target="_blank"');

    editor.destroy();
  });

  it("drops unsafe image link hrefs loaded from stored content", () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "imageBlock",
          attrs: {
            src: "/api/v1/public/images/asset_1/file",
            linkHref: "javascript:alert(1)",
            linkTarget: "_blank",
          },
        },
      ],
    });

    expect(editor.getHTML()).not.toContain("javascript:alert");
    expect(editor.getHTML()).not.toContain("<a ");

    editor.destroy();
  });
});
