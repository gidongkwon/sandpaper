import { describe, expect, it } from "vitest";
import { createRefinePageHash } from "./refine-session-hash";

describe("refine session hash", () => {
  const basePage = {
    pageUid: "project-atlas",
    title: "Project Atlas",
    blocks: [
      {
        id: "block-1",
        text: "First block",
        indent: 0,
        block_type: "text" as const
      },
      {
        id: "block-2",
        text: "Nested block",
        indent: 1,
        block_type: "todo" as const
      }
    ]
  };

  it("returns the same hash for the same input", () => {
    expect(createRefinePageHash(basePage)).toBe(createRefinePageHash(basePage));
  });

  it("changes when block text changes", () => {
    expect(
      createRefinePageHash({
        ...basePage,
        blocks: [
          basePage.blocks[0],
          {
            ...basePage.blocks[1],
            text: "Updated nested block"
          }
        ]
      })
    ).not.toBe(createRefinePageHash(basePage));
  });

  it("changes when block indent changes", () => {
    expect(
      createRefinePageHash({
        ...basePage,
        blocks: [
          basePage.blocks[0],
          {
            ...basePage.blocks[1],
            indent: 2
          }
        ]
      })
    ).not.toBe(createRefinePageHash(basePage));
  });

  it("changes when title changes", () => {
    expect(
      createRefinePageHash({
        ...basePage,
        title: "Project Borealis"
      })
    ).not.toBe(createRefinePageHash(basePage));
  });
});
