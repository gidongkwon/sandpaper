import type { Block, Page } from "./block-model";

const INDENT_UNIT = "  ";

const formatBlockLine = (block: Block) => {
  const indent = INDENT_UNIT.repeat(Math.max(0, block.indent));
  const text = block.text.trimEnd();
  const spacer = text.length > 0 ? " " : "";
  const type = block.block_type ?? "text";
  const marker = type === "text" ? "" : ` <!--sp:{"type":"${type}"}-->`;
  return `${indent}- ${text}${spacer}^${block.id}${marker}`;
};

export const serializeBlocksToMarkdown = (blocks: Block[]) => {
  if (blocks.length === 0) return "";
  return `${blocks.map(formatBlockLine).join("\n")}\n`;
};

export const serializePageToMarkdown = (page: Page) => {
  return `# ${page.title} ^${page.id}\n${serializeBlocksToMarkdown(page.blocks)}`;
};
