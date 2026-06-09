// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getTableElementFromToolbarTarget,
  resolveBlockToolbarTarget,
} from "./blockTarget";

function createEditorDom(html: string): HTMLElement {
  const editorDom = document.createElement("div");
  editorDom.className = "tiptap-editor ProseMirror";
  editorDom.innerHTML = html;
  document.body.replaceChildren(editorDom);
  return editorDom;
}

describe("resolveBlockToolbarTarget", () => {
  it("normalizes inline syntax inside a paragraph to the paragraph block", () => {
    const editorDom = createEditorDom(`
      <p id="paragraph">before <code id="inline-code">code</code> after</p>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("#inline-code"),
      editorDom,
    );

    expect(target?.kind).toBe("block");
    expect(target?.element).toBe(editorDom.querySelector("#paragraph"));
  });

  it("normalizes inline marks inside a heading to the heading block", () => {
    const editorDom = createEditorDom(`
      <h2 id="heading">Title <mark id="mark"><strong>important</strong></mark></h2>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("strong"),
      editorDom,
    );

    expect(target?.kind).toBe("block");
    expect(target?.element).toBe(editorDom.querySelector("#heading"));
  });

  it("normalizes nested list content to the parent top-level list item", () => {
    const editorDom = createEditorDom(`
      <ul>
        <li id="outer">
          <p>outer</p>
          <ul>
            <li id="inner"><p><a id="inner-link">inner</a></p></li>
          </ul>
        </li>
      </ul>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("#inner-link"),
      editorDom,
    );

    expect(target?.kind).toBe("block");
    expect(target?.element).toBe(editorDom.querySelector("#outer"));
    expect(target?.anchorElement).toBe(editorDom.querySelector("#outer"));
  });

  it("treats a table cell hit as a table target and keeps table metadata", () => {
    const editorDom = createEditorDom(`
      <div id="wrapper" class="tableWrapper">
        <table id="table">
          <tbody>
            <tr>
              <td id="cell"><p><code id="cell-code">cell</code></p></td>
            </tr>
          </tbody>
        </table>
      </div>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("#cell-code"),
      editorDom,
    );

    expect(target?.kind).toBe("table");
    expect(target?.element).toBe(editorDom.querySelector("#wrapper"));
    expect(target?.tableElement).toBe(editorDom.querySelector("#table"));
    expect(target?.tableCellElement).toBe(editorDom.querySelector("#cell"));
    expect(getTableElementFromToolbarTarget(target?.element ?? null)).toBe(
      editorDom.querySelector("#table"),
    );
  });

  it("uses blockquote as the stable visual anchor when editing inside it", () => {
    const editorDom = createEditorDom(`
      <blockquote id="quote"><p id="quote-paragraph"><strong>quoted</strong></p></blockquote>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("strong"),
      editorDom,
    );

    expect(target?.kind).toBe("block");
    expect(target?.element).toBe(editorDom.querySelector("#quote"));
    expect(target?.anchorElement).toBe(editorDom.querySelector("#quote"));
  });

  it("uses highlight block as the stable visual anchor when editing inner paragraphs", () => {
    const editorDom = createEditorDom(`
      <div id="highlight" class="highlight-block-view">
        <p id="highlight-paragraph"><mark>highlighted</mark></p>
      </div>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("mark"),
      editorDom,
    );

    expect(target?.kind).toBe("block");
    expect(target?.element).toBe(editorDom.querySelector("#highlight"));
    expect(target?.anchorElement).toBe(editorDom.querySelector("#highlight"));
  });

  it("keeps a paragraph as the operation target while using its list item as the anchor", () => {
    const editorDom = createEditorDom(`
      <ul>
        <li id="item"><p id="item-paragraph"><code>inner</code></p></li>
      </ul>
    `);

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("code"),
      editorDom,
    );

    expect(target?.kind).toBe("block");
    expect(target?.element).toBe(editorDom.querySelector("#item"));
    expect(target?.anchorElement).toBe(editorDom.querySelector("#item"));
  });

  it("chooses the parent top-level list item under the pointer when nested list boxes overlap", () => {
    const editorDom = createEditorDom(`
      <ul id="root-list">
        <li id="outer">
          <p>outer</p>
          <ul id="nested-list">
            <li id="inner"><p>inner</p></li>
          </ul>
        </li>
      </ul>
    `);
    const outer = editorDom.querySelector<HTMLElement>("#outer")!;
    const inner = editorDom.querySelector<HTMLElement>("#inner")!;

    outer.getBoundingClientRect = () => ({
      top: 0,
      bottom: 100,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    inner.getBoundingClientRect = () => ({
      top: 40,
      bottom: 70,
      left: 32,
      right: 300,
      width: 268,
      height: 30,
      x: 32,
      y: 40,
      toJSON: () => ({}),
    });

    const target = resolveBlockToolbarTarget(
      editorDom.querySelector("#root-list"),
      editorDom,
      50,
    );

    expect(target?.element).toBe(outer);
    expect(target?.anchorElement).toBe(outer);
  });
});
