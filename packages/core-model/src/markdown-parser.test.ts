import { describe, expect, it } from "vitest";
import { parseMarkdownPage } from "./markdown-parser";

const buildIdFactory = () => {
  let index = 0;
  return () => {
    index += 1;
    return `id-${index}`;
  };
};

describe("parseMarkdownPage", () => {
  it("parses a header with ids and nested blocks", () => {
    const makeId = buildIdFactory();
    const result = parseMarkdownPage(
      "# Project Plan ^page-1\n- First line ^block-1\n  - Child line ^block-2\n",
      makeId
    );

    expect(result.hasHeader).toBe(true);
    expect(result.page.id).toBe("page-1");
    expect(result.page.title).toBe("Project Plan");
    expect(result.page.blocks).toEqual([
      { id: "block-1", text: "First line", indent: 0, block_type: "text" },
      { id: "block-2", text: "Child line", indent: 1, block_type: "text" }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("generates ids for missing or duplicate block ids", () => {
    const makeId = buildIdFactory();
    const result = parseMarkdownPage(
      "# Imported\n- Alpha\n- Beta ^dup\n- Gamma ^dup\n",
      makeId
    );

    expect(result.page.id).toBe("id-1");
    expect(result.page.blocks.map((block) => block.id)).toEqual([
      "id-2",
      "dup",
      "id-3"
    ]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("strips plugin metadata annotations", () => {
    const makeId = buildIdFactory();
    const result = parseMarkdownPage(
      "# Notes\n- Task item ^block-1 <!--sp:{\"plugin\":\"todo\"}-->\n",
      makeId
    );

    expect(result.page.blocks[0]?.text).toBe("Task item");
    expect(result.page.blocks[0]?.block_type).toBe("text");
  });

  it("parses block type metadata markers", () => {
    const makeId = buildIdFactory();
    const result = parseMarkdownPage(
      "# Notes\n- Heading line ^block-1 <!--sp:{\"type\":\"heading1\"}-->\n",
      makeId
    );

    expect(result.page.blocks[0]?.block_type).toBe("heading1");
  });

  it("warns when ignoring non-list lines", () => {
    const makeId = buildIdFactory();
    const result = parseMarkdownPage(
      "Intro line\n- Line ^block-1\nAnother line\n",
      makeId
    );

    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
