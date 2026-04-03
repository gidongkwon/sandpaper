import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_UID,
  DEFAULT_PAGE_TITLE,
  HIDDEN_INBOX_PAGE_UID,
  HIDDEN_INBOX_PAGE_TITLE,
  defaultBlocks,
  resolveInitialBlocks
} from "./main-page-defaults";

describe("main page defaults", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("exposes the default page uid", () => {
    expect(DEFAULT_PAGE_UID).toBe("home");
    expect(DEFAULT_PAGE_TITLE).toBe("Home");
    expect(HIDDEN_INBOX_PAGE_UID).toBe("inbox");
    expect(HIDDEN_INBOX_PAGE_TITLE).toBe("Inbox");
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
