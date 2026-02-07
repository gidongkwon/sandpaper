import { describe, expect, it } from "vitest";
import { serializePageToMarkdown } from "./markdown-serializer";
import type { Page } from "./block-model";

describe("serializePageToMarkdown", () => {
  it("serializes title and blocks with inline ids", () => {
    const page: Page = {
      id: "page-1",
      title: "Daily Notes",
      blocks: [
        { id: "b1", text: "First block", indent: 0 },
        { id: "b2", text: "Child block", indent: 1 },
        { id: "b3", text: "Second block", indent: 0 }
      ]
    };

    expect(serializePageToMarkdown(page)).toBe(
      "# Daily Notes ^page-1\n" +
        "- First block ^b1\n" +
        "  - Child block ^b2\n" +
        "- Second block ^b3\n"
    );
  });

  it("serializes empty block text with inline id", () => {
    const page: Page = {
      id: "page-2",
      title: "Empty",
      blocks: [{ id: "b1", text: "", indent: 0 }]
    };

    expect(serializePageToMarkdown(page)).toBe("# Empty ^page-2\n- ^b1\n");
  });

  it("serializes non-text block types as sp metadata markers", () => {
    const page: Page = {
      id: "page-3",
      title: "Typed",
      blocks: [{ id: "b1", text: "Important", indent: 0, block_type: "callout" }]
    };

    expect(serializePageToMarkdown(page)).toBe(
      "# Typed ^page-3\n- Important ^b1 <!--sp:{\"type\":\"callout\"}-->\n"
    );
  });
});
