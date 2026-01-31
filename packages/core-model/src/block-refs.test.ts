import { describe, expect, it } from "vitest";
import {
  buildBacklinks,
  buildWikilinkBacklinks,
  extractBlockRefs,
  extractWikiLinks
} from "./block-refs";

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

describe("extractWikiLinks", () => {
  it("extracts unique wiki links", () => {
    const links = extractWikiLinks(
      "See [[Project Atlas]] and [[Project Atlas]] plus [[Inbox|home]]"
    );
    expect(links).toEqual(["Project Atlas", "Inbox"]);
  });

  it("ignores empty or malformed wiki links", () => {
    const links = extractWikiLinks("[[]] and [[   ]] and [[#section]]");
    expect(links).toEqual([]);
  });
});

describe("buildWikilinkBacklinks", () => {
  it("builds backlink map from wiki links", () => {
    const blocks = [
      { id: "b1", text: "Link [[Project Atlas]]" },
      { id: "b2", text: "[[Inbox]] and [[Project Atlas|Atlas]]" },
      { id: "b3", text: "No links" }
    ];

    const backlinks = buildWikilinkBacklinks(blocks);

    expect(backlinks).toEqual({
      "Project Atlas": ["b1", "b2"],
      Inbox: ["b2"]
    });
  });

  it("supports custom normalization", () => {
    const blocks = [{ id: "b1", text: "See [[Project Atlas]]" }];
    const backlinks = buildWikilinkBacklinks(
      blocks,
      (value) => value.toLowerCase().replace(/\s+/g, "-")
    );

    expect(backlinks).toEqual({
      "project-atlas": ["b1"]
    });
  });
});
