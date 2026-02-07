import type { BlockType } from "../../../entities/block/model/block-types";

const HEADING_1_PATTERN = /^#\s+/u;
const HEADING_2_PATTERN = /^##\s+/u;
const HEADING_3_PATTERN = /^###\s+/u;
const TODO_PATTERN = /^(?:-?\s*)\[(?: |x|X)\]\s+/u;
const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.+)\)$/u;

const stripPrefix = (value: string, prefix: string) =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;

const stripHeadingPrefix = (value: string) => {
  const trimmed = value.trimStart();
  if (trimmed.startsWith("### ")) return trimmed.slice(4);
  if (trimmed.startsWith("## ")) return trimmed.slice(3);
  if (trimmed.startsWith("# ")) return trimmed.slice(2);
  return trimmed;
};

const normalizeImageSource = (source: string): string | null => {
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

export const extractImageSource = (value: string): string | null => {
  const trimmed = value.trim();
  const markdownMatch = trimmed.match(MARKDOWN_IMAGE_PATTERN);
  if (markdownMatch) {
    return normalizeImageSource(markdownMatch[2] ?? "");
  }
  return normalizeImageSource(trimmed);
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
  if (trimmed.startsWith("> ")) return "quote";
  if (TODO_PATTERN.test(trimmed)) return "todo";
  if (trimmed.startsWith("```")) return "code";
  if (extractImageSource(trimmed)) return "image";
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
    case "divider":
      return "";
    case "image":
      return extractImageSource(trimmed) ?? trimmed;
    default:
      return trimmed;
  }
};
