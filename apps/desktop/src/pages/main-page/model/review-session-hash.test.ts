import { describe, expect, it } from "vitest";
import { createReviewPageHash } from "./review-session-hash";

describe("review session hash", () => {
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
    expect(createReviewPageHash(basePage)).toBe(createReviewPageHash(basePage));
  });

  it("changes when block text changes", () => {
    expect(
      createReviewPageHash({
        ...basePage,
        blocks: [
          basePage.blocks[0],
          {
            ...basePage.blocks[1],
            text: "Updated nested block"
          }
        ]
      })
    ).not.toBe(createReviewPageHash(basePage));
  });

  it("changes when block indent changes", () => {
    expect(
      createReviewPageHash({
        ...basePage,
        blocks: [
          basePage.blocks[0],
          {
            ...basePage.blocks[1],
            indent: 2
          }
        ]
      })
    ).not.toBe(createReviewPageHash(basePage));
  });

  it("changes when title changes", () => {
    expect(
      createReviewPageHash({
        ...basePage,
        title: "Project Borealis"
      })
    ).not.toBe(createReviewPageHash(basePage));
  });
});
