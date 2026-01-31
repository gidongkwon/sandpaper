import { describe, expect, it } from "vitest";
import { buildBacklinks, extractBlockRefs } from "./block-refs";

describe("extractBlockRefs", () => {
  it("extracts unique block references", () => {
    const refs = extractBlockRefs("See ((abc-123)) and ((abc-123)) plus ((xyz))");
    expect(refs).toEqual(["abc-123", "xyz"]);
  });

  it("ignores malformed references", () => {
    const refs = extractBlockRefs("((missing) extra)) and (())");
    expect(refs).toEqual([]);
  });
});

describe("buildBacklinks", () => {
  it("builds backlink map from block text", () => {
    const blocks = [
      { id: "b1", text: "Links to ((b2))" },
      { id: "b2", text: "References ((b3))" },
      { id: "b3", text: "" },
      { id: "b4", text: "((b2)) and ((b3))" }
    ];

    const backlinks = buildBacklinks(blocks);

    expect(backlinks).toEqual({
      b2: ["b1", "b4"],
      b3: ["b2", "b4"]
    });
  });
});
