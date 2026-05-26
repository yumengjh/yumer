"use client";

import { useEffect } from "react";
import {
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
import {
  renderCodeBlockBodyHtml,
  tokenLineToHtml,
} from "@/components/markdown-editor/code/codeBlockLineHtml";
import {
  bindPublicCodeBlockChrome,
  renderPublicCodeBlockChrome,
} from "@/components/markdown-editor/code/publicCodeBlockChrome";

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

function renderBody(code: string, attrs: CodeBlockAttrs, lineContents?: string[]): string {
  return renderCodeBlockBodyHtml({
    code,
    lineNumbers: attrs.lineNumbers,
    lineContents,
  });
}

export default function ClientCodeBlockRenderer() {
  useEffect(() => {
    let cancelled = false;
    const unbindChrome = bindPublicCodeBlockChrome(document);

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
        element.classList.toggle("has-line-numbers", attrs.lineNumbers);
        element.classList.remove("is-code-collapsed");
        element.classList.toggle("is-status-collapsed", attrs.statusBarCollapsed);
        element.style.setProperty("--code-tab-size", String(attrs.indentSize));
        element.style.setProperty(
          "--code-font-size",
          attrs.fontSize === "inherit" ? "inherit" : attrs.fontSize,
        );

        const statusHtml = renderPublicCodeBlockChrome(attrs);
        let bodyHtml = renderBody(code, attrs);

        if (highlighter) {
          try {
            const explicitTheme = getCodeThemeByName(attrs.codeTheme);
            const theme = explicitTheme || getCodeThemeByMode(readThemeMode());
            const lang = resolveCodeLanguageForShiki(highlighter, attrs.language);
            const { tokens } = highlighter.codeToTokens(code, { lang, theme });
            const lineContents = tokens.map((line) => tokenLineToHtml(line));
            bodyHtml = renderBody(code, attrs, lineContents);
          } catch (error) {
            console.log("[public-doc] code block render failed", error);
          }
        }

        element.innerHTML = statusHtml + bodyHtml;
        element.dataset.codeBlockRendered = "true";
      }
    }

    const runWhenIdle = () => {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => {
          void renderAll();
        });
        return;
      }

      globalThis.setTimeout(() => {
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
      unbindChrome();
    };
  }, []);

  return null;
}
