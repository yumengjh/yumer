import { codeLanguageItems } from "../Toolbar/data";
import { escapeCodeHtml, type CodeBlockAttrs } from "./codeBlockOptions";

const COPY_ICON = `<svg class="code-block-public-icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;

const CHECK_ICON = `<svg class="code-block-public-icon-check" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

const FOLD_ICON = `<svg class="code-block-public-fold-icon" width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5z"/></svg>`;

export function getCodeLanguageLabel(language: string): string {
  const normalized = language.trim().toLowerCase();
  const item = codeLanguageItems.find((entry) => entry.key === normalized);
  return item?.label ?? (language.trim() || "Plain Text");
}

function renderPublicCopyButton(extraClass = ""): string {
  const className = ["code-block-public-copy", extraClass].filter(Boolean).join(" ");
  return [
    `<button type="button" class="${className}" aria-label="复制代码" data-code-copy="true">`,
    `<span class="code-block-public-copy-icon">${COPY_ICON}${CHECK_ICON}</span>`,
    `<span class="code-block-public-copy-label">复制代码</span>`,
    `</button>`,
  ].join("");
}

function renderPublicStatusBarChrome(attrs: CodeBlockAttrs): string {
  const title = attrs.title.trim();
  const titleText = title || "未命名代码块";
  const titleClass = title ? "code-block-public-title" : "code-block-public-title is-placeholder";
  const languageLabel = getCodeLanguageLabel(attrs.language);

  return [
    `<div class="code-block-status-shell code-block-public-chrome">`,
    `<div class="code-block-status-bar">`,
    `<div class="code-block-toolbar-left">`,
    `<button type="button" class="code-block-public-fold" aria-expanded="true" aria-label="折叠代码">`,
    FOLD_ICON,
    `</button>`,
    `<span class="${titleClass}">${escapeCodeHtml(titleText)}</span>`,
    `</div>`,
    `<div class="code-block-toolbar-right">`,
    `<span class="code-block-public-language">${escapeCodeHtml(languageLabel)}</span>`,
    `<span class="code-block-toolbar-separator" aria-hidden="true"></span>`,
    renderPublicCopyButton(),
    `</div>`,
    `</div>`,
    `</div>`,
  ].join("");
}

/** 编辑器折叠状态栏时：仅右上角悬浮复制按钮（hover 显示） */
function renderPublicMinimalChrome(): string {
  return [
    `<div class="code-block-public-chrome code-block-public-chrome--minimal">`,
    renderPublicCopyButton("code-block-public-copy--floating"),
    `</div>`,
  ].join("");
}

export function renderPublicCodeBlockChrome(attrs: CodeBlockAttrs): string {
  if (attrs.statusBarCollapsed) {
    return renderPublicMinimalChrome();
  }
  return renderPublicStatusBarChrome(attrs);
}

/** @deprecated Use renderPublicCodeBlockChrome */
export function renderPublicCodeBlockStatusBar(attrs: CodeBlockAttrs): string {
  return renderPublicCodeBlockChrome(attrs);
}

const COPY_RESET_MS = 2000;

export function bindPublicCodeBlockChrome(root: ParentNode = document): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const foldButton = target.closest<HTMLButtonElement>(".code-block-public-fold");
    if (foldButton) {
      const view = foldButton.closest<HTMLElement>(".code-block-view");
      if (!view) return;
      const collapsed = view.classList.toggle("is-code-collapsed");
      foldButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
      foldButton.setAttribute("aria-label", collapsed ? "展开代码" : "折叠代码");
      return;
    }

    const copyButton = target.closest<HTMLButtonElement>(".code-block-public-copy");
    if (!copyButton) return;

    const view = copyButton.closest<HTMLElement>(".code-block-view");
    if (!view) return;

    const code =
      view.getAttribute("data-code-block-code") ||
      view.querySelector(".code-block-body")?.textContent ||
      "";

    if (!code || !navigator.clipboard) return;

    void navigator.clipboard.writeText(code).then(() => {
      if (copyButton.dataset.copyTimer) {
        window.clearTimeout(Number(copyButton.dataset.copyTimer));
      }
      copyButton.classList.add("is-copied");
      copyButton.setAttribute("aria-label", "已复制");
      const timer = window.setTimeout(() => {
        copyButton.classList.remove("is-copied");
        copyButton.setAttribute("aria-label", "复制代码");
        delete copyButton.dataset.copyTimer;
      }, COPY_RESET_MS);
      copyButton.dataset.copyTimer = String(timer);
    });
  };

  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
