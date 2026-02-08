import { describe, expect, it } from "vitest";
import {
  ALL_SUPPORTED_BLOCK_TYPES,
  buildAllBlockTypeShowcaseBlocks
} from "./block-seeds";

describe("block seeds", () => {
  it("builds a showcase page with every supported block type", () => {
    let next = 1;
    const blocks = buildAllBlockTypeShowcaseBlocks(() => `b${next++}`);
    const presentTypes = new Set(blocks.map((block) => block.block_type ?? "text"));

    for (const blockType of ALL_SUPPORTED_BLOCK_TYPES) {
      expect(presentTypes.has(blockType)).toBe(true);
    }

    const database = blocks.find((block) => block.block_type === "database_view");
    expect(database?.text.startsWith("```database")).toBe(true);

    const layoutIndex = blocks.findIndex(
      (block) => block.block_type === "column_layout"
    );
    expect(layoutIndex).toBeGreaterThanOrEqual(0);
    const layoutIndent = blocks[layoutIndex]?.indent ?? 0;
    const nestedInLayout = blocks.slice(layoutIndex + 1).filter((block) => {
      return block.indent > layoutIndent;
    });
    expect(nestedInLayout.some((block) => block.block_type === "column")).toBe(true);
    expect(
      nestedInLayout.some(
        (block) =>
          block.block_type !== "column" && block.block_type !== "column_layout"
      )
    ).toBe(true);
  });
});
