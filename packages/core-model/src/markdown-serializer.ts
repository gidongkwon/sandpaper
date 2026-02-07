import type { Block, Page } from "./block-model";

const INDENT_UNIT = "  ";
const TODO_PREFIX_PATTERN = /^-?\s*\[(?: |x|X)\]\s+/u;
const TODO_CHECKED_PATTERN = /^-?\s*\[(?:x|X)\]\s+/u;
const MARKDOWN_IMAGE_PATTERN = /^!\[(.*?)\]\((.+)\)$/u;

const isHeadingType = (type: Block["block_type"] | undefined) =>
  type === "heading1" || type === "heading2" || type === "heading3";

const isMarkdownNativeType = (type: Block["block_type"] | undefined) =>
  type === "text" ||
  isHeadingType(type) ||
  type === "quote" ||
  type === "todo" ||
  type === "divider" ||
  type === "code" ||
  type === "image";

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

const formatCodeText = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) return value.trimEnd();
  return trimmed.length > 0 ? `\`\`\`text ${trimmed}` : "```text ";
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

const extractImageSource = (value: string): string | null => {
  const trimmed = value.trim();
  const markdownMatch = trimmed.match(MARKDOWN_IMAGE_PATTERN);
  if (markdownMatch) {
    return normalizeImageSource(markdownMatch[2] ?? "");
  }
  return normalizeImageSource(trimmed);
};

const formatImageText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (MARKDOWN_IMAGE_PATTERN.test(trimmed)) return trimmed;
  const source = extractImageSource(trimmed);
  return source ? `![](${source})` : trimmed;
};

const formatBlockLine = (block: Block) => {
  const indent = INDENT_UNIT.repeat(Math.max(0, block.indent));
  const type = block.block_type ?? "text";
  const text =
    type === "heading1"
      ? formatHeadingText(block.text, 1)
      : type === "heading2"
        ? formatHeadingText(block.text, 2)
        : type === "heading3"
          ? formatHeadingText(block.text, 3)
          : type === "quote"
            ? formatQuoteText(block.text)
            : type === "todo"
              ? formatTodoText(block.text)
              : type === "divider"
                ? "---"
                : type === "code"
                  ? formatCodeText(block.text)
                  : type === "image"
                    ? formatImageText(block.text)
                    : block.text.trimEnd();
  const spacer = text.length > 0 ? " " : "";
  const marker = isMarkdownNativeType(type) ? "" : ` <!--sp:{"type":"${type}"}-->`;
  return `${indent}- ${text}${spacer}^${block.id}${marker}`;
};

export const serializeBlocksToMarkdown = (blocks: Block[]) => {
  if (blocks.length === 0) return "";
  return `${blocks.map(formatBlockLine).join("\n")}\n`;
};

export const serializePageToMarkdown = (page: Page) => {
  return `# ${page.title} ^${page.id}\n${serializeBlocksToMarkdown(page.blocks)}`;
};
