import type { HighlighterGeneric } from "shiki";
import { CODE_LANGUAGE_OPTIONS, resolveShikiLanguage } from "./code-language";

const SHIKI_THEME = "github-light";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fallbackCodeHtml = (code: string) =>
  `<pre class="shiki shiki--fallback"><code>${escapeHtml(code)}</code></pre>`;

let highlighterPromise:
  | Promise<HighlighterGeneric<string, string>>
  | null = null;

const getHighlighter = async () => {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [SHIKI_THEME],
        langs: CODE_LANGUAGE_OPTIONS.map((option) => option.shiki)
      }) as Promise<HighlighterGeneric<string, string>>
    );
  }
  return highlighterPromise;
};

export const highlightCodeWithShiki = async (code: string, lang: string) => {
  const shikiLang = resolveShikiLanguage(lang);
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, {
      lang: shikiLang,
      theme: SHIKI_THEME
    });
  } catch (error) {
    console.error("Failed to render shiki highlight", error);
    return fallbackCodeHtml(code);
  }
};
