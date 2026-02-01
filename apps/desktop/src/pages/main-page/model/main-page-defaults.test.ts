import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_UID,
  defaultBlocks,
  resolveInitialBlocks
} from "./main-page-defaults";

describe("main page defaults", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("exposes the default page uid", () => {
    expect(DEFAULT_PAGE_UID).toBe("inbox");
  });

  it("falls back to default blocks when no seed is provided", () => {
    const blocks = resolveInitialBlocks();
    expect(blocks.length).toBe(defaultBlocks.length);
  });

  it("uses seed blocks when a seed query is present", () => {
    window.history.replaceState({}, "", "/?seed=3");
    const blocks = resolveInitialBlocks();
    expect(blocks.length).toBe(3);
  });

  it("falls back to default blocks when seed is invalid", () => {
    window.history.replaceState({}, "", "/?seed=0");
    const blocks = resolveInitialBlocks();
    expect(blocks.length).toBe(defaultBlocks.length);
  });
});
