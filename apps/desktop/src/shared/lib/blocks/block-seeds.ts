import type { Block } from "../../../entities/block/model/block-types";
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

export const getSeedCount = (): number | null => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};
