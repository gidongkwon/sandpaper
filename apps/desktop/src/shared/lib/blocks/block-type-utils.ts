import type { BlockType } from "../../../entities/block/model/block-types";
import { parseMarkdownTable } from "../markdown/inline-parser";

const HEADING_1_PATTERN = /^#\s+/u;
const HEADING_2_PATTERN = /^##\s+/u;
const HEADING_3_PATTERN = /^###\s+/u;
const ORDERED_LIST_PATTERN = /^\d+\.\s+/u;
const TODO_PATTERN = /^(?:-?\s*)\[(?: |x|X)\]\s+/u;
const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.+)\)$/u;
const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/u;
const INLINE_TABLE_ROW_PATTERN = /^\|(.+)\|$/u;
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

const stripPrefix = (value: string, prefix: string) =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;

const stripHeadingPrefix = (value: string) => {
  const trimmed = value.trimStart();
  if (trimmed.startsWith("### ")) return trimmed.slice(4);
  if (trimmed.startsWith("## ")) return trimmed.slice(3);
  if (trimmed.startsWith("# ")) return trimmed.slice(2);
  return trimmed;
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

const normalizeImageSource = (source: string): string | null => {
  const normalized = normalizeUrlLikeSource(source);
  if (!normalized) return null;
  const ext = extractPathExtension(normalized);
  return IMAGE_EXTENSIONS.has(ext) ? normalized : null;
};

const parseMarkdownLink = (value: string) => {
  const match = value.trim().match(MARKDOWN_LINK_PATTERN);
  if (!match) return null;
  const label = (match[1] ?? "").trim();
  const hrefRaw = match[2] ?? "";
  const href = normalizeUrlLikeSource(hrefRaw);
  if (!href) return null;
  return {
    label: label || href,
    href
  };
};

const sourceHasFileExtension = (source: string) => {
  const ext = extractPathExtension(source);
  return ext.length > 0 && !IMAGE_EXTENSIONS.has(ext);
};

export const extractImageSource = (value: string): string | null => {
  const trimmed = value.trim();
  const markdownMatch = trimmed.match(MARKDOWN_IMAGE_PATTERN);
  if (markdownMatch) {
    return normalizeImageSource(markdownMatch[2] ?? "");
  }
  return normalizeImageSource(trimmed);
};

export const extractBookmarkSource = (value: string): string | null => {
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

export const extractFileSource = (value: string) => {
  const trimmed = value.trim();
  const link = parseMarkdownLink(trimmed);
  if (link && sourceHasFileExtension(link.href)) {
    return {
      source: link.href,
      label: link.label
    };
  }
  const source = normalizeUrlLikeSource(trimmed);
  if (!source || !sourceHasFileExtension(source)) return null;
  const fallbackLabel = source.split("/").pop() ?? source;
  return {
    source,
    label: fallbackLabel
  };
};

export const isTodoChecked = (value: string) => {
  const trimmed = value.trimStart();
  return trimmed.startsWith("- [x] ") || trimmed.startsWith("[x] ");
};

const stripTodoPrefix = (value: string) =>
  value
    .trimStart()
    .replace(/^-?\s*\[(?: |x|X)\]\s+/u, "")
    .trimStart();

const stripOrderedListPrefix = (value: string) =>
  value
    .trimStart()
    .replace(/^\d+\.\s+/u, "")
    .trimStart();

const stripMathFence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("$$")) return trimmed;
  const withoutOpen = trimmed.replace(/^\$\$\s*/u, "");
  const withoutClose = withoutOpen.replace(/\s*\$\$$/u, "");
  return withoutClose.trim();
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

const normalizeDatabaseQuery = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("query=")) {
    return trimmed.slice("query=".length).trim();
  }
  if (trimmed.toLowerCase().startsWith("query:")) {
    return trimmed.slice("query:".length).trim();
  }
  return trimmed;
};

export const extractDatabaseQuery = (value: string) => parseDatabaseQuery(value);

export const formatDatabaseBlockText = (value: string) => {
  const parsedQuery = parseDatabaseQuery(value);
  const query = normalizeDatabaseQuery(parsedQuery ?? value.trim());
  return query ? `\`\`\`database ${query}` : "```database";
};

const isInlineTableRow = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.includes("\n")) return false;
  const match = trimmed.match(INLINE_TABLE_ROW_PATTERN);
  if (!match) return false;
  const content = match[1] ?? "";
  const cells = content.split("|").map((cell) => cell.trim());
  return cells.length >= 2;
};

export const toggleTodoText = (value: string, checked: boolean) => {
  const content = stripTodoPrefix(value);
  return checked ? `- [x] ${content}` : `- [ ] ${content}`;
};

export const inferBlockTypeFromText = (value: string): BlockType => {
  const trimmed = value.trim();
  if (!trimmed) return "text";
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
  if (parseMarkdownTable(trimmed) || isInlineTableRow(trimmed)) return "table";
  if (extractImageSource(trimmed)) return "image";
  if (extractFileSource(trimmed)) return "file";
  if (extractBookmarkSource(trimmed)) return "bookmark";
  return "text";
};

const isHeadingType = (value: BlockType | null | undefined) =>
  value === "heading1" || value === "heading2" || value === "heading3";

const inferHeadingTypeFromText = (value: string) => {
  const inferred = inferBlockTypeFromText(value);
  return isHeadingType(inferred) ? inferred : null;
};

export const resolveBlockType = (value: {
  text: string;
  block_type?: BlockType | null;
}): BlockType => value.block_type ?? inferBlockTypeFromText(value.text);

export const resolveRenderBlockType = (value: {
  text: string;
  block_type?: BlockType | null;
}): BlockType => {
  const supportsMarkdownHeading =
    value.block_type === undefined ||
    value.block_type === null ||
    value.block_type === "text" ||
    isHeadingType(value.block_type);
  const inferredHeading = supportsMarkdownHeading
    ? inferHeadingTypeFromText(value.text)
    : null;
  if (inferredHeading) return inferredHeading;
  return resolveBlockType(value);
};

export const cleanTextForBlockType = (value: string, blockType: BlockType) => {
  const trimmed = value.trim();
  switch (blockType) {
    case "heading1":
    case "heading2":
    case "heading3":
      return stripHeadingPrefix(trimmed);
    case "quote":
      return stripPrefix(trimmed, "> ");
    case "todo":
      return stripTodoPrefix(trimmed);
    case "ordered_list":
      return stripOrderedListPrefix(trimmed);
    case "divider":
      return "";
    case "image":
      return extractImageSource(trimmed) ?? trimmed;
    case "bookmark":
      return extractBookmarkSource(trimmed) ?? trimmed;
    case "file":
      return extractFileSource(trimmed)?.source ?? trimmed;
    case "math":
      return stripMathFence(trimmed);
    case "toc":
      return "";
    case "database_view":
      return parseDatabaseQuery(trimmed) ?? trimmed;
    default:
      return trimmed;
  }
};
