import { describe, expect, it } from "vitest";
import {
  createBlock,
  indentBlock,
  mergeBlockWithPrevious,
  moveBlockRange,
  outdentBlock,
  splitBlock
} from "./outline";

describe("outline ops", () => {
  it("splits a block at cursor", () => {
    const blocks = [createBlock("a", "hello world", 0), createBlock("b", "next", 0)];

    const { blocks: next, newIndex } = splitBlock(blocks, 0, 5, "c");

    expect(next[0].text).toBe("hello");
    expect(next[1].text).toBe(" world");
    expect(next[1].id).toBe("c");
    expect(next[1].indent).toBe(0);
    expect(newIndex).toBe(1);
  });

  it("merges a block with its previous sibling", () => {
    const blocks = [createBlock("a", "hello", 0), createBlock("b", "world", 0)];

    const { blocks: next, mergedIndex } = mergeBlockWithPrevious(blocks, 1);

    expect(next).toHaveLength(1);
    expect(next[0].text).toBe("helloworld");
    expect(mergedIndex).toBe(0);
  });

  it("indents a block and its subtree", () => {
    const blocks = [
      createBlock("a", "parent", 0),
      createBlock("b", "child", 1),
      createBlock("c", "sibling", 0)
    ];

    const next = indentBlock(blocks, 0);

    expect(next[0].indent).toBe(0);
    expect(next[1].indent).toBe(1);
    expect(next[2].indent).toBe(0);
  });

  it("outdents a block and its subtree", () => {
    const blocks = [
      createBlock("a", "parent", 1),
      createBlock("b", "child", 2),
      createBlock("c", "sibling", 1)
    ];

    const next = outdentBlock(blocks, 0);

    expect(next[0].indent).toBe(0);
    expect(next[1].indent).toBe(1);
    expect(next[2].indent).toBe(1);
  });

  it("moves a block range with its subtree", () => {
    const blocks = [
      createBlock("a", "A", 0),
      createBlock("b", "A1", 1),
      createBlock("c", "B", 0),
      createBlock("d", "C", 0)
    ];

    const next = moveBlockRange(blocks, 0, 3);

    expect(next.map((block) => block.id)).toEqual(["c", "a", "b", "d"]);
  });
});
