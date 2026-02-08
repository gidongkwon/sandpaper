import type {
  CodeFence,
  InlineLinkToken,
  MarkdownTable,
  InlineWikilinkToken,
  MarkdownList
} from "../../model/markdown-types";

export const INLINE_MARKDOWN_PATTERN =
  /(\[\[[^\]]+?\]\]|\[[^\]]+?\]\([^)]+?\)|`[^`]+`|\*\*[^*]+?\*\*|~~[^~]+?~~|\*[^*]+?\*)/g;

const ORDERED_LIST_PATTERN = /^\s*\d+\.\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^\s*[-*+]\s+(.+)$/;
const TABLE_ROW_PATTERN = /^\|(.+)\|$/u;
const TABLE_DIVIDER_CELL_PATTERN = /^:?-{3,}:?$/u;

export const parseInlineFence = (text: string): CodeFence | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return null;
  const body = trimmed.slice(3);
  const newlineIndex = body.indexOf("\n");

  if (newlineIndex >= 0) {
    const header = body.slice(0, newlineIndex).trim();
    if (!header) return null;
    const [lang] = header.split(/\s+/);
    if (!lang) return null;
    const contentBody = body.slice(newlineIndex + 1);
    const closingFence = contentBody.match(/^(.*?)(?:\n```[\t ]*)$/su);
    const content = (closingFence?.[1] ?? contentBody).trimEnd();
    if (!content) return null;
    return {
      lang: lang.toLowerCase(),
      content
    };
  }

  const rest = body.trim();
  if (!rest) return null;
  const [lang, ...codeParts] = rest.split(/\s+/);
  if (!lang || codeParts.length === 0) return null;
  const content = codeParts.join(" ").replace(/\s+```$/u, "").trimEnd();
  if (!content) return null;
  return {
    lang: lang.toLowerCase(),
    content
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

const parseTableRow = (line: string): string[] | null => {
  const trimmed = line.trim();
  const match = trimmed.match(TABLE_ROW_PATTERN);
  if (!match) return null;
  const content = match[1] ?? "";
  const cells = content.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
};

export const parseMarkdownTable = (text: string): MarkdownTable | null => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const headers = parseTableRow(lines[0]);
  const divider = parseTableRow(lines[1]);
  if (!headers || !divider || headers.length !== divider.length) return null;
  if (!divider.every((cell) => TABLE_DIVIDER_CELL_PATTERN.test(cell))) return null;
  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const row = parseTableRow(line);
    if (!row || row.length !== headers.length) return null;
    rows.push(row);
  }
  return { headers, rows };
};
