// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  enhancePublicHeadingAnchors,
  PUBLIC_HEADING_SCROLL_OFFSET,
  resolvePublicHeadingHash,
  updatePublicHeadingHash,
} from "./public-heading-anchor";

describe("public heading anchors", () => {
  it("prefers an existing heading id", () => {
    const heading = document.createElement("h2");
    heading.id = "GxzQyl";
    heading.textContent = "软件服务交付模型";

    expect(resolvePublicHeadingHash(heading, 0)).toBe("GxzQyl");
  });

  it("falls back to heading text when no id exists", () => {
    const heading = document.createElement("h2");
    heading.textContent = "软件服务交付模型";

    expect(resolvePublicHeadingHash(heading, 0)).toBe("软件服务交付模型");
  });

  it("injects left-side hash links and updates url on click", () => {
    document.body.innerHTML = `
      <div class="doc-content">
        <h2>软件服务交付模型</h2>
      </div>
    `;
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const heading = document.querySelector<HTMLElement>(".doc-content h2")!;
    heading.getBoundingClientRect = () =>
      ({
        top: 120,
        left: 0,
        right: 100,
        bottom: 160,
        width: 100,
        height: 40,
        x: 0,
        y: 120,
        toJSON: () => ({}),
      }) as DOMRect;

    enhancePublicHeadingAnchors(document, PUBLIC_HEADING_SCROLL_OFFSET);

    const anchor = document.querySelector<HTMLAnchorElement>(".doc-heading-anchor")!;
    expect(heading.id).toBe("软件服务交付模型");
    expect(anchor.getAttribute("href")).toBe("#软件服务交付模型");
    expect(anchor.textContent).toBe("#");

    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(replaceStateSpy).toHaveBeenCalled();
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 120 - PUBLIC_HEADING_SCROLL_OFFSET,
      behavior: "smooth",
    });
  });

  it("writes the heading hash into the current url", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const nextUrl = updatePublicHeadingHash("软件服务交付模型");

    expect(nextUrl).toContain("#%E8%BD%AF%E4%BB%B6%E6%9C%8D%E5%8A%A1%E4%BA%A4%E4%BB%98%E6%A8%A1%E5%9E%8B");
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", nextUrl);
  });
});
