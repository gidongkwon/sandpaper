import type { Block, BlockType } from "../../../entities/block/model/block-types";
import { makeBlock } from "../../../entities/block/model/make-block";

const CORE_BLOCK_SEEDS = [
  { text: "Sandpaper outline prototype", indent: 0 },
  { text: "Enter to add a block", indent: 1 },
  { text: "Tab to indent, Shift+Tab to outdent", indent: 1 },
  { text: "Backspace on empty removes the block", indent: 1 }
];

export const MAX_SEED_BLOCKS = 200_000;

export const buildSeedBlocks = (
  idFactory: () => string,
  count: number
): Block[] => {
  const total = Math.max(1, Math.min(count, MAX_SEED_BLOCKS));
  const fillerCount = Math.max(0, total - CORE_BLOCK_SEEDS.length);
  const filler = Array.from({ length: fillerCount }, (_, index) => ({
    text: `Draft line ${index + 1}`,
    indent: index % 3
  }));

  return [...CORE_BLOCK_SEEDS, ...filler]
    .slice(0, total)
    .map(({ text, indent }) => makeBlock(idFactory(), text, indent));
};

export const buildDefaultBlocks = (idFactory: () => string): Block[] => {
  const filler = Array.from({ length: 60 }, (_, index) => ({
    text: `Draft line ${index + 1}`,
    indent: index % 3
  }));

  return [...CORE_BLOCK_SEEDS, ...filler].map(({ text, indent }) =>
    makeBlock(idFactory(), text, indent)
  );
};

export const buildEmptyBlocks = (idFactory: () => string): Block[] => [
  makeBlock(idFactory(), "", 0)
];

const SUPPORTED_BLOCK_TYPE_MAP: Record<BlockType, true> = {
  text: true,
  heading1: true,
  heading2: true,
  heading3: true,
  quote: true,
  callout: true,
  code: true,
  divider: true,
  toggle: true,
  todo: true,
  image: true,
  table: true,
  ordered_list: true,
  bookmark: true,
  file: true,
  math: true,
  toc: true,
  column_layout: true,
  column: true,
  database_view: true
};

export const ALL_SUPPORTED_BLOCK_TYPES = Object.keys(
  SUPPORTED_BLOCK_TYPE_MAP
) as BlockType[];

export const BLOCK_TYPE_SHOWCASE_TITLE = "Block Type Showcase";

export const buildAllBlockTypeShowcaseBlocks = (
  idFactory: () => string
): Block[] => [
  makeBlock(idFactory(), "Plain text block", 0, "text"),
  makeBlock(idFactory(), "Heading 1 block", 0, "heading1"),
  makeBlock(idFactory(), "Heading 2 block", 0, "heading2"),
  makeBlock(idFactory(), "Heading 3 block", 0, "heading3"),
  makeBlock(idFactory(), "Quoted block", 0, "quote"),
  makeBlock(idFactory(), "Callout block", 0, "callout"),
  makeBlock(idFactory(), "Toggle block", 0, "toggle"),
  makeBlock(idFactory(), "- [ ] Todo block", 0, "todo"),
  makeBlock(idFactory(), "1. Ordered list block", 0, "ordered_list"),
  makeBlock(idFactory(), "```ts\nconst sample = 42;\n```", 0, "code"),
  makeBlock(idFactory(), "$$ E = mc^2 $$", 0, "math"),
  makeBlock(idFactory(), "| Name | Value |\n| --- | --- |\n| Alpha | 1 |", 0, "table"),
  makeBlock(idFactory(), "[TOC]", 0, "toc"),
  makeBlock(idFactory(), "https://example.com", 0, "bookmark"),
  makeBlock(idFactory(), "[sample.pdf](/assets/sample.pdf)", 0, "file"),
  makeBlock(idFactory(), "![](/assets/sample.png)", 0, "image"),
  makeBlock(idFactory(), "---", 0, "divider"),
  makeBlock(idFactory(), "```database project", 0, "database_view"),
  makeBlock(idFactory(), "", 0, "column_layout"),
  makeBlock(idFactory(), "", 1, "column"),
  makeBlock(idFactory(), "Left column text block", 2, "text"),
  makeBlock(idFactory(), "", 1, "column"),
  makeBlock(idFactory(), "Right column todo", 2, "todo")
];

export const getSeedCount = (): number | null => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};
