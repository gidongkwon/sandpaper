import type { Block, Page } from "./block-model";

export type MarkdownParseResult = {
  page: Page;
  warnings: string[];
  hasHeader: boolean;
};

const INDENT_UNIT = 2;
const DEFAULT_TITLE = "Imported";

const stripPluginMetadata = (value: string) =>
  value.replace(/\s*<!--sp:.*?-->\s*$/u, "");

const extractTrailingId = (value: string) => {
  const match = value.match(/^(.*?)(?:\s+\^([A-Za-z0-9-]+))\s*$/u);
  if (!match) {
    return { text: value, id: null as string | null };
  }
  return { text: match[1] ?? "", id: match[2] ?? null };
};

const normalizeIndent = (value: string) => value.replace(/\t/g, "  ");

export const parseMarkdownPage = (
  markdown: string,
  makeId: () => string
): MarkdownParseResult => {
  const warnings: string[] = [];
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let cursor = 0;

  while (cursor < lines.length && lines[cursor]?.trim() === "") {
    cursor += 1;
  }

  let hasHeader = false;
  let pageTitle = DEFAULT_TITLE;
  let pageId = makeId();

  const headerLine = lines[cursor] ?? "";
  if (headerLine.trim().startsWith("#")) {
    const headerText = headerLine.replace(/^#+\s*/u, "").trim();
    const cleaned = stripPluginMetadata(headerText);
    const parsed = extractTrailingId(cleaned);
    pageTitle = parsed.text.trim() || "Untitled";
    if (parsed.id) {
      pageId = parsed.id;
    }
    hasHeader = true;
    cursor += 1;
  }

  const seenIds = new Set<string>();
  const blocks: Block[] = [];

  for (; cursor < lines.length; cursor += 1) {
    const rawLine = lines[cursor] ?? "";
    if (rawLine.trim() === "") continue;

    const match = rawLine.match(/^(\s*)-\s*(.*)$/u);
    if (!match) {
      warnings.push(`Ignored line ${cursor + 1}: not a list item.`);
      continue;
    }

    const indentText = normalizeIndent(match[1] ?? "");
    const indent = Math.floor(indentText.length / INDENT_UNIT);
    const rawText = stripPluginMetadata(match[2] ?? "");
    const { text, id } = extractTrailingId(rawText.trimEnd());

    let resolvedId = id;
    if (!resolvedId) {
      resolvedId = makeId();
      warnings.push(`Line ${cursor + 1}: missing block id, generated ${resolvedId}.`);
    }
    if (seenIds.has(resolvedId)) {
      const replacement = makeId();
      warnings.push(
        `Line ${cursor + 1}: duplicate block id ${resolvedId}, replaced with ${replacement}.`
      );
      resolvedId = replacement;
    }

    seenIds.add(resolvedId);
    blocks.push({
      id: resolvedId,
      text: text.trimEnd(),
      indent
    });
  }

  if (blocks.length === 0) {
    warnings.push("No list items found in Markdown.");
  }

  return {
    page: {
      id: pageId,
      title: pageTitle,
      blocks
    },
    warnings,
    hasHeader
  };
};
