import type { Block, Page } from "./block-model";

const INDENT_UNIT = "  ";
const TODO_PREFIX_PATTERN = /^-?\s*\[(?: |x|X)\]\s+/u;
const TODO_CHECKED_PATTERN = /^-?\s*\[(?:x|X)\]\s+/u;
const ORDERED_LIST_PREFIX_PATTERN = /^\d+\.\s+/u;
const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.+)\)$/u;
const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/u;
const TOC_PATTERN = /^\[(?:toc)\]$/iu;
const DATABASE_INLINE_PATTERN = /^```database(?:\s+([\s\S]*))?$/iu;
const DATABASE_MULTILINE_PATTERN = /^```database\s*\n([\s\S]*?)(?:\n```)?$/iu;
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

const isHeadingType = (type: Block["block_type"] | undefined) =>
  type === "heading1" || type === "heading2" || type === "heading3";

const isMarkdownNativeType = (type: Block["block_type"] | undefined) =>
  type === "text" ||
  isHeadingType(type) ||
  type === "quote" ||
  type === "todo" ||
  type === "divider" ||
  type === "code" ||
  type === "table" ||
  type === "image" ||
  type === "ordered_list" ||
  type === "bookmark" ||
  type === "file" ||
  type === "math" ||
  type === "toc" ||
  type === "database_view";

const stripHeadingPrefix = (value: string) => {
  const trimmed = value.trimStart();
  if (trimmed.startsWith("### ")) return trimmed.slice(4);
  if (trimmed.startsWith("## ")) return trimmed.slice(3);
  if (trimmed.startsWith("# ")) return trimmed.slice(2);
  return trimmed;
};

const formatHeadingText = (value: string, level: 1 | 2 | 3) => {
  const prefix = "#".repeat(level);
  const content = stripHeadingPrefix(value).trimEnd();
  return content.length > 0 ? `${prefix} ${content}` : prefix;
};

const formatQuoteText = (value: string) => {
  const trimmed = value.trimStart();
  if (trimmed.startsWith("> ")) return trimmed.trimEnd();
  const content = trimmed.trimEnd();
  return content.length > 0 ? `> ${content}` : ">";
};

const stripTodoPrefix = (value: string) =>
  value
    .trimStart()
    .replace(TODO_PREFIX_PATTERN, "")
    .trimStart();

const formatTodoText = (value: string) => {
  const trimmed = value.trimStart();
  const checked = TODO_CHECKED_PATTERN.test(trimmed);
  const content = stripTodoPrefix(value).trimEnd();
  return checked ? `- [x] ${content}` : `- [ ] ${content}`;
};

const stripOrderedListPrefix = (value: string) =>
  value
    .trimStart()
    .replace(ORDERED_LIST_PREFIX_PATTERN, "")
    .trimStart();

const formatOrderedListText = (value: string) => {
  const trimmed = value.trimStart();
  if (ORDERED_LIST_PREFIX_PATTERN.test(trimmed)) return trimmed.trimEnd();
  const content = stripOrderedListPrefix(value).trimEnd();
  return content.length > 0 ? `1. ${content}` : "1. ";
};

const formatCodeText = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) return value.trimEnd();
  return trimmed.length > 0 ? `\`\`\`text ${trimmed}` : "```text ";
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
  const label = (match[1] ?? "").trim();
  const href = normalizeUrlLikeSource(match[2] ?? "");
  if (!href) return null;
  return {
    label: label || href,
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
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
  if (extractImageSource(trimmed)) return null;
  if (sourceHasFileExtension(trimmed)) return null;
  return trimmed;
};

const formatBookmarkText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "https://";
  const bookmark = extractBookmarkSource(trimmed);
  return bookmark ?? trimmed;
};

const extractFileReference = (value: string) => {
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
  return {
    source,
    label: source.split("/").pop() ?? source
  };
};

const formatFileText = (value: string) => {
  const reference = extractFileReference(value);
  if (!reference) return value.trimEnd();
  return `[${reference.label}](${reference.source})`;
};

const formatImageText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (MARKDOWN_IMAGE_PATTERN.test(trimmed)) return trimmed;
  const source = extractImageSource(trimmed);
  return source ? `![](${source})` : trimmed;
};

const formatTableText = (value: string) => value.trimEnd();

const formatMathText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "$$ $$";
  if (trimmed.startsWith("$$")) {
    return trimmed.endsWith("$$") ? trimmed : `${trimmed} $$`;
  }
  return `$$ ${trimmed} $$`;
};

const formatTocText = (value: string) => {
  const trimmed = value.trim();
  if (TOC_PATTERN.test(trimmed)) return "[TOC]";
  return "[TOC]";
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

const formatDatabaseText = (value: string) => {
  const parsedQuery = parseDatabaseQuery(value);
  const query = normalizeDatabaseQuery(parsedQuery ?? value.trim());
  return query ? `\`\`\`database ${query}` : "```database";
};

const formatMultilineListText = (value: string, continuationIndent: string) => {
  const lines = value.split("\n");
  if (lines.length <= 1) return value;
  return lines
    .map((line, index) => (index === 0 ? line : `${continuationIndent}${line}`))
    .join("\n");
};

const formatBlockLine = (block: Block) => {
  const indent = INDENT_UNIT.repeat(Math.max(0, block.indent));
  const type = block.block_type ?? "text";
  const text = (() => {
    switch (type) {
      case "heading1":
        return formatHeadingText(block.text, 1);
      case "heading2":
        return formatHeadingText(block.text, 2);
      case "heading3":
        return formatHeadingText(block.text, 3);
      case "quote":
        return formatQuoteText(block.text);
      case "todo":
        return formatTodoText(block.text);
      case "divider":
        return "---";
      case "code":
        return formatCodeText(block.text);
      case "table":
        return formatTableText(block.text);
      case "image":
        return formatImageText(block.text);
      case "ordered_list":
        return formatOrderedListText(block.text);
      case "bookmark":
        return formatBookmarkText(block.text);
      case "file":
        return formatFileText(block.text);
      case "math":
        return formatMathText(block.text);
      case "toc":
        return formatTocText(block.text);
      case "database_view":
        return formatDatabaseText(block.text);
      default:
        return block.text.trimEnd();
    }
  })();
  const formattedText = formatMultilineListText(text, `${indent}${INDENT_UNIT}`);
  const spacer = text.length > 0 ? " " : "";
  const marker = isMarkdownNativeType(type) ? "" : ` <!--sp:{"type":"${type}"}-->`;
  return `${indent}- ${formattedText}${spacer}^${block.id}${marker}`;
};

export const serializeBlocksToMarkdown = (blocks: Block[]) => {
  if (blocks.length === 0) return "";
  return `${blocks.map(formatBlockLine).join("\n")}\n`;
};

export const serializePageToMarkdown = (page: Page) => {
  return `# ${page.title} ^${page.id}\n${serializeBlocksToMarkdown(page.blocks)}`;
};
