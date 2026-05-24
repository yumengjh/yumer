"use client";

import { useEffect } from "react";
import {
  escapeCodeHtml,
  normalizeCodeBlockAttrs,
  type CodeBlockAttrs,
} from "@/components/markdown-editor/code/codeBlockOptions";
import {
  getCodeThemeByMode,
  getCodeThemeByName,
  getShikiHighlighter,
  resolveCodeLanguageForShiki,
  type CodeThemeMode,
} from "@/components/markdown-editor/code/codeHighlight";

function readAttrs(element: HTMLElement): CodeBlockAttrs {
  const raw = element.getAttribute("data-code-block-attrs");
  if (!raw) return normalizeCodeBlockAttrs();

  try {
    return normalizeCodeBlockAttrs(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return normalizeCodeBlockAttrs();
  }
}

function readThemeMode(): CodeThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderFallback(code: string, attrs: CodeBlockAttrs, codeHtml?: string): string {
  const lines = code.split("\n");
  const numbers = attrs.lineNumbers
    ? `<div class="code-block-line-numbers">${lines
        .map((_, index) => `<span class="code-block-line-number">${index + 1}</span>`)
        .join("")}</div>`
    : "";
  return `<div class="code-block-body">${numbers}<div class="code-block-content"><code>${codeHtml ?? escapeCodeHtml(code)}</code></div></div>`;
}

function renderStatus(attrs: CodeBlockAttrs): string {
  if (attrs.statusBarCollapsed) {
    return "";
  }

  return [
    `<div class="code-block-status-bar">`,
    `<span class="code-block-public-title">${escapeCodeHtml(attrs.title || attrs.language)}</span>`,
    `<span>${escapeCodeHtml(attrs.language)}</span>`,
    `</div>`,
  ].join("");
}

export default function ClientCodeBlockRenderer() {
  useEffect(() => {
    let cancelled = false;

    async function renderAll() {
      const placeholders = Array.from(
        document.querySelectorAll<HTMLElement>("[data-code-block-placeholder='true']"),
      );
      if (placeholders.length === 0) return;

      const highlighter = await getShikiHighlighter().catch(() => null);

      for (const element of placeholders) {
        if (cancelled || element.dataset.codeBlockRendered === "true") continue;

        const attrs = readAttrs(element);
        const code =
          element.getAttribute("data-code-block-code") ||
          element.querySelector("code")?.textContent ||
          "";
        element.dataset.language = attrs.language;
        element.dataset.codeTheme = attrs.codeTheme;
        element.classList.toggle("is-wrapped", attrs.wordWrap);
        element.classList.toggle("is-status-collapsed", attrs.statusBarCollapsed);
        element.classList.toggle("is-code-collapsed", attrs.codeCollapsed);
        element.style.setProperty("--code-tab-size", String(attrs.indentSize));
        element.style.setProperty(
          "--code-font-size",
          attrs.fontSize === "inherit" ? "inherit" : attrs.fontSize,
        );

        const statusHtml = renderStatus(attrs);

        if (attrs.codeCollapsed) {
          element.innerHTML = statusHtml;
          element.dataset.codeBlockRendered = "true";
          continue;
        }

        if (!highlighter) {
          element.innerHTML = statusHtml + renderFallback(code, attrs);
          element.dataset.codeBlockRendered = "true";
          continue;
        }

        try {
          const explicitTheme = getCodeThemeByName(attrs.codeTheme);
          const theme = explicitTheme || getCodeThemeByMode(readThemeMode());
          const lang = resolveCodeLanguageForShiki(highlighter, attrs.language);
          const highlighted = highlighter.codeToHtml(code, { lang, theme });
          const temp = document.createElement("div");
          temp.innerHTML = highlighted;
          const codeHtml = temp.querySelector("code")?.innerHTML || escapeCodeHtml(code);
          element.innerHTML = statusHtml + renderFallback(code, attrs, codeHtml);
        } catch (error) {
          console.log("[public-doc] code block render failed", error);
          element.innerHTML = statusHtml + renderFallback(code, attrs);
        }
        element.dataset.codeBlockRendered = "true";
      }
    }

    const runWhenIdle = () => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        window.requestIdleCallback(() => {
          void renderAll();
        });
        return;
      }

      window.setTimeout(() => {
        void renderAll();
      }, 0);
    };

    const start = () => {
      if (cancelled) return;
      runWhenIdle();
    };

    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
    };
  }, []);

  return null;
}
