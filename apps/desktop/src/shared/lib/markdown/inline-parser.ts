import type {
  CodeFence,
  InlineLinkToken,
  InlineWikilinkToken,
  MarkdownList
} from "../../model/markdown-types";

export const INLINE_MARKDOWN_PATTERN =
  /(\[\[[^\]]+?\]\]|\[[^\]]+?\]\([^)]+?\)|`[^`]+`|\*\*[^*]+?\*\*|~~[^~]+?~~|\*[^*]+?\*)/g;

const ORDERED_LIST_PATTERN = /^\s*\d+\.\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^\s*[-*+]\s+(.+)$/;

export const parseInlineFence = (text: string): CodeFence | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return null;
  const rest = trimmed.slice(3).trim();
  if (!rest) return null;
  const [lang, ...codeParts] = rest.split(/\s+/);
  if (!lang || codeParts.length === 0) return null;
  return {
    lang: lang.toLowerCase(),
    content: codeParts.join(" ")
  };
};

export const parseWikilinkToken = (token: string): InlineWikilinkToken | null => {
  if (!token.startsWith("[[") || !token.endsWith("]]")) return null;
  const raw = token.slice(2, -2).trim();
  if (!raw) return null;
  const [beforeAlias, alias] = raw.split("|");
  const [beforeHeading] = beforeAlias.split("#");
  const target = beforeHeading.trim();
  if (!target) return null;
  const label = (alias ?? beforeAlias).trim() || target;
  return { target, label };
};

export const parseInlineLinkToken = (token: string): InlineLinkToken | null => {
  const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (!match) return null;
  const label = match[1]?.trim() ?? "";
  const href = match[2]?.trim() ?? "";
  if (!label || !href) return null;
  if (href.toLowerCase().startsWith("javascript:")) return null;
  return { label, href };
};

export const parseMarkdownList = (text: string): MarkdownList | null => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const orderedMatches = lines.map((line) => line.match(ORDERED_LIST_PATTERN));
  const isOrdered = orderedMatches.every(Boolean);
  const unorderedMatches = lines.map((line) =>
    line.match(UNORDERED_LIST_PATTERN)
  );
  const isUnordered = unorderedMatches.every(Boolean);
  if (!isOrdered && !isUnordered) return null;
  const items = (isOrdered ? orderedMatches : unorderedMatches).map(
    (match) => (match?.[1] ?? "").trim()
  );
  return {
    type: isOrdered ? "ol" : "ul",
    items
  };
};
