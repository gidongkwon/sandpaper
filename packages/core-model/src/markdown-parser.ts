import type { Block, BlockType, Page } from "./block-model";

export type MarkdownParseResult = {
  page: Page;
  warnings: string[];
  hasHeader: boolean;
};

const INDENT_UNIT = 2;
const DEFAULT_TITLE = "Imported";

const SP_METADATA_PATTERN = /\s*<!--sp:(.*?)-->\s*$/u;
const HEADING_1_PATTERN = /^#\s+/u;
const HEADING_2_PATTERN = /^##\s+/u;
const HEADING_3_PATTERN = /^###\s+/u;
const ORDERED_LIST_PATTERN = /^\d+\.\s+/u;
const TODO_PATTERN = /^(?:-?\s*)\[(?: |x|X)\]\s+/u;
const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.+)\)$/u;
const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/u;
const TABLE_ROW_PATTERN = /^\|(.+)\|$/u;
const TABLE_DIVIDER_CELL_PATTERN = /^:?-{3,}:?$/u;
const TOC_PATTERN = /^\[(?:toc)\]$/iu;
const DATABASE_INLINE_PATTERN = /^```database(?:\s+([\s\S]*))?$/iu;
const DATABASE_MULTILINE_PATTERN = /^```database\s*\n([\s\S]*?)(?:\n```)?$/iu;
const URL_PATTERN = /^https?:\/\/\S+$/u;
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "bmp",
  "tif",
  "tiff",
  "ico"
]);

const extractPathExtension = (source: string) => {
  const cleanPath = source.split(/[?#]/u, 1)[0] ?? source;
  let resolvedPath = cleanPath;
  if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
    try {
      resolvedPath = new URL(cleanPath).pathname;
    } catch {
      resolvedPath = cleanPath;
    }
  }
  const lastSegment = resolvedPath.split("/").pop() ?? "";
  if (!lastSegment || !lastSegment.includes(".")) return "";
  return lastSegment.split(".").pop()?.toLowerCase() ?? "";
};

const normalizeUrlLikeSource = (source: string): string | null => {
  const trimmed = source.trim();
  if (!trimmed) return null;
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length > 2
      ? trimmed.slice(1, -1)
      : trimmed;
  if (
    unwrapped.startsWith("http://") ||
    unwrapped.startsWith("https://") ||
    unwrapped.startsWith("/assets/")
  ) {
    return unwrapped;
  }
  return null;
};

const sourceHasFileExtension = (source: string) => {
  const ext = extractPathExtension(source);
  return ext.length > 0 && !IMAGE_EXTENSIONS.has(ext);
};

const normalizeImageSource = (source: string): string | null => {
  const normalized = normalizeUrlLikeSource(source);
  if (!normalized) return null;
  const ext = extractPathExtension(normalized);
  return IMAGE_EXTENSIONS.has(ext) ? normalized : null;
};

const extractImageSource = (value: string): string | null => {
  const trimmed = value.trim();
  const markdownMatch = trimmed.match(MARKDOWN_IMAGE_PATTERN);
  if (markdownMatch) {
    return normalizeImageSource(markdownMatch[2] ?? "");
  }
  return normalizeImageSource(trimmed);
};

const parseMarkdownLink = (value: string) => {
  const match = value.trim().match(MARKDOWN_LINK_PATTERN);
  if (!match) return null;
  const href = normalizeUrlLikeSource(match[2] ?? "");
  if (!href) return null;
  return {
    href
  };
};

const extractBookmarkSource = (value: string): string | null => {
  const trimmed = value.trim();
  const link = parseMarkdownLink(trimmed);
  if (link && link.href.startsWith("http")) {
    if (extractImageSource(link.href)) return null;
    if (sourceHasFileExtension(link.href)) return null;
    return link.href;
  }
  if (!URL_PATTERN.test(trimmed)) return null;
  if (extractImageSource(trimmed)) return null;
  if (sourceHasFileExtension(trimmed)) return null;
  return trimmed;
};

const extractFileSource = (value: string): string | null => {
  const trimmed = value.trim();
  const link = parseMarkdownLink(trimmed);
  if (link && sourceHasFileExtension(link.href)) {
    return link.href;
  }
  const source = normalizeUrlLikeSource(trimmed);
  if (!source || !sourceHasFileExtension(source)) return null;
  return source;
};

const parseTableRow = (line: string): string[] | null => {
  const trimmed = line.trim();
  const match = trimmed.match(TABLE_ROW_PATTERN);
  if (!match) return null;
  const content = match[1] ?? "";
  const cells = content.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
};

const isMarkdownTable = (value: string) => {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return false;
  const header = parseTableRow(lines[0]);
  const divider = parseTableRow(lines[1]);
  if (!header || !divider || header.length !== divider.length) return false;
  if (!divider.every((cell) => TABLE_DIVIDER_CELL_PATTERN.test(cell))) return false;
  for (const line of lines.slice(2)) {
    const row = parseTableRow(line);
    if (!row || row.length !== header.length) return false;
  }
  return true;
};

const isInlineTableRow = (value: string) => {
  if (value.includes("\n")) return false;
  return parseTableRow(value) !== null;
};

const parseDatabaseQuery = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("```database")) return null;
  const multilineMatch = trimmed.match(DATABASE_MULTILINE_PATTERN);
  const inlineMatch = multilineMatch ? null : trimmed.match(DATABASE_INLINE_PATTERN);
  const rawQuery = (multilineMatch?.[1] ?? inlineMatch?.[1] ?? "").trim();
  if (!rawQuery) return "";
  if (rawQuery.toLowerCase().startsWith("query=")) {
    return rawQuery.slice("query=".length).trim();
  }
  if (rawQuery.toLowerCase().startsWith("query:")) {
    return rawQuery.slice("query:".length).trim();
  }
  return rawQuery;
};

const inferMarkdownNativeBlockType = (value: string): BlockType | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "---") return "divider";
  if (HEADING_3_PATTERN.test(trimmed)) return "heading3";
  if (HEADING_2_PATTERN.test(trimmed)) return "heading2";
  if (HEADING_1_PATTERN.test(trimmed)) return "heading1";
  if (TOC_PATTERN.test(trimmed)) return "toc";
  if (trimmed.startsWith("$$")) return "math";
  if (trimmed.startsWith("> ")) return "quote";
  if (TODO_PATTERN.test(trimmed)) return "todo";
  if (ORDERED_LIST_PATTERN.test(trimmed)) return "ordered_list";
  if (parseDatabaseQuery(trimmed) !== null) return "database_view";
  if (trimmed.startsWith("```")) return "code";
  if (isMarkdownTable(trimmed) || isInlineTableRow(trimmed)) return "table";
  if (extractImageSource(trimmed)) return "image";
  if (extractFileSource(trimmed)) return "file";
  if (extractBookmarkSource(trimmed)) return "bookmark";
  return null;
};

const parseSpBlockType = (raw: string): BlockType | null => {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown } | null;
    if (!parsed || typeof parsed.type !== "string") return null;
    const value = parsed.type;
    const known: BlockType[] = [
      "callout",
      "toggle",
      "column_layout",
      "column",
      "database_view"
    ];
    return known.includes(value as BlockType) ? (value as BlockType) : null;
  } catch {
    return null;
  }
};

const extractSpMetadata = (value: string) => {
  const match = value.match(SP_METADATA_PATTERN);
  if (!match) {
    return {
      text: value,
      blockType: null as BlockType | null
    };
  }
  return {
    text: value.replace(SP_METADATA_PATTERN, ""),
    blockType: parseSpBlockType(match[1] ?? "")
  };
};

const extractTrailingId = (value: string) => {
  const match = value.match(/^([\s\S]*?)(?:\s+\^([A-Za-z0-9-]+))\s*$/u);
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
    const cleaned = extractSpMetadata(headerText).text;
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

  while (cursor < lines.length) {
    const rawLine = lines[cursor] ?? "";
    if (rawLine.trim() === "") {
      cursor += 1;
      continue;
    }

    const match = rawLine.match(/^(\s*)-\s*(.*)$/u);
    if (!match) {
      warnings.push(`Ignored line ${cursor + 1}: not a list item.`);
      cursor += 1;
      continue;
    }

    const indentText = normalizeIndent(match[1] ?? "");
    const indentLength = indentText.length;
    const indent = Math.floor(indentLength / INDENT_UNIT);
    let blockText = normalizeIndent(match[2] ?? "");
    while (cursor + 1 < lines.length) {
      const nextLine = lines[cursor + 1] ?? "";
      if (!nextLine.trim()) break;

      const nextItem = nextLine.match(/^(\s*)-\s*(.*)$/u);
      if (nextItem) break;

      const normalizedNext = normalizeIndent(nextLine);
      const nextIndentMatch = normalizedNext.match(/^(\s*)/u);
      const nextIndentText = nextIndentMatch?.[1] ?? "";
      if (nextIndentText.length < indentLength + INDENT_UNIT) break;
      const nextContent = normalizedNext.slice(indentLength + INDENT_UNIT);
      blockText = `${blockText}\n${nextContent}`;
      cursor += 1;
    }

    const withMetadata = extractSpMetadata(blockText);
    const { text, id } = extractTrailingId(withMetadata.text.trimEnd());

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
    const normalizedText = text.trimEnd();
    const inferredType = inferMarkdownNativeBlockType(normalizedText);
    blocks.push({
      id: resolvedId,
      text: normalizedText,
      indent,
      block_type: withMetadata.blockType ?? inferredType ?? "text"
    });
    cursor += 1;
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
