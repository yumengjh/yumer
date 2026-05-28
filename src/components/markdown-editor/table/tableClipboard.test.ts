import { describe, expect, it } from "vitest";
import {
  buildTableHtmlFromTextGrid,
  extractFirstTableHtml,
  parseTabularPlainText,
  isTabularPlainText,
} from "./tableClipboard";

describe("tableClipboard", () => {
  it("detects tabular plain text", () => {
    expect(isTabularPlainText("a\tb\n1\t2")).toBe(true);
    expect(isTabularPlainText("plain text")).toBe(false);
  });

  it("normalizes tabular plain text into a rectangular grid", () => {
    expect(parseTabularPlainText("a\tb\n1")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });

  it("builds table html from a text grid", () => {
    expect(buildTableHtmlFromTextGrid([["a", "b"]])).toContain("<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>");
  });

  it("extracts the first table from html", () => {
    expect(extractFirstTableHtml("<div>before</div><table><tr><td>x</td></tr></table>")).toContain("<table>");
  });
});
