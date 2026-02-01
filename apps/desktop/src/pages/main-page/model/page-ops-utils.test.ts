import { describe, expect, it } from "vitest";
import { updateBlocksWithWikilinks } from "./page-ops-utils";

describe("page ops utils", () => {
  it("updates wikilinks and tracks changes", () => {
    const blocks = [
      { id: "1", text: "Link to [[Old]]" },
      { id: "2", text: "No link here" }
    ];

    const result = updateBlocksWithWikilinks(blocks, "Old", "New");
    expect(result.changed).toBe(true);
    expect(result.updated[0]?.text).toBe("Link to [[New]]");
    expect(result.updated[1]).toBe(blocks[1]);
  });

  it("returns unchanged data when no wikilinks match", () => {
    const blocks = [{ id: "1", text: "No link" }];
    const result = updateBlocksWithWikilinks(blocks, "Old", "New");
    expect(result.changed).toBe(false);
    expect(result.updated[0]).toBe(blocks[0]);
  });
});
