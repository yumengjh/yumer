import {
  getShikiHighlighter,
  resolveCodeLanguageForShiki,
  SHIKI_LIGHT_THEME,
} from "@/components/markdown-editor/code/codeHighlight";
import {
  renderCodeBlockBodyHtml,
  tokenLineToHtml,
} from "@/components/markdown-editor/code/codeBlockLineHtml";

const codeBlockRegex = /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

export async function highlightCodeBlocks(html: string): Promise<string> {
  const highlighter = await getShikiHighlighter();
  const theme = SHIKI_LIGHT_THEME;

  const replacements = new Map<string, string>();
  let match;

  codeBlockRegex.lastIndex = 0;

  while ((match = codeBlockRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const langAttr = match[1];
    const rawCode = match[2];

    const code = rawCode
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    const lang = resolveCodeLanguageForShiki(highlighter, langAttr);

    try {
      const { tokens } = highlighter.codeToTokens(code, { lang, theme });
      const lineContents = tokens.map((line) => tokenLineToHtml(line));
      const bodyHtml = renderCodeBlockBodyHtml({
        code,
        lineNumbers: true,
        lineContents,
      });

      const highlightedHtml = `<pre class="code-block-view tiptap-codeblock-node has-line-numbers" data-language="${langAttr}">${bodyHtml}</pre>`;
      replacements.set(fullMatch, highlightedHtml);
    } catch (e) {
      console.error("Highlighting error:", e);
    }
  }

  let result = html;
  for (const [original, replaced] of replacements) {
    result = result.replace(original, replaced);
  }

  return result;
}
