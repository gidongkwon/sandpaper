import { describe, expect, it } from "vitest";
import {
  cleanTextForBlockType,
  extractImageSource,
  formatDatabaseBlockText,
  inferBlockTypeFromText,
  extractDatabaseQuery,
  resolveRenderBlockType,
  isTodoChecked,
  toggleTodoText
} from "./block-type-utils";

describe("block-type-utils", () => {
  it("infers markdown-native and rich block types", () => {
    expect(inferBlockTypeFromText("# Title")).toBe("heading1");
    expect(inferBlockTypeFromText("## Title")).toBe("heading2");
    expect(inferBlockTypeFromText("### Title")).toBe("heading3");
    expect(inferBlockTypeFromText("> quoted")).toBe("quote");
    expect(inferBlockTypeFromText("- [ ] task")).toBe("todo");
    expect(inferBlockTypeFromText("---")).toBe("divider");
    expect(inferBlockTypeFromText("```ts const x = 1")).toBe("code");
    expect(inferBlockTypeFromText("1. First")).toBe("ordered_list");
    expect(inferBlockTypeFromText("```database project")).toBe("database_view");
    expect(inferBlockTypeFromText("https://example.com/article")).toBe("bookmark");
    expect(inferBlockTypeFromText("[doc](/assets/spec--abc123.pdf)")).toBe("file");
    expect(inferBlockTypeFromText("$$ E = mc^2 $$")).toBe("math");
    expect(inferBlockTypeFromText("[TOC]")).toBe("toc");
    expect(
      inferBlockTypeFromText(
        "| Name | Qty |\n| --- | --- |\n| Pencil | 2 |"
      )
    ).toBe("table");
  });

  it("extracts image sources from markdown and direct paths", () => {
    expect(extractImageSource("![cat](https://example.com/cat.png)")).toBe(
      "https://example.com/cat.png"
    );
    expect(extractImageSource("/assets/cat--abc123.png")).toBe(
      "/assets/cat--abc123.png"
    );
    expect(extractImageSource("file:///tmp/cat.png")).toBeNull();
  });

  it("infers image type from valid image sources", () => {
    expect(inferBlockTypeFromText("![cat](/assets/cat--abc123.png)")).toBe("image");
    expect(inferBlockTypeFromText("https://example.com/cat.png")).toBe("image");
  });

  it("cleans text according to block type", () => {
    expect(cleanTextForBlockType("# Hello", "heading1")).toBe("Hello");
    expect(cleanTextForBlockType("> Quote", "quote")).toBe("Quote");
    expect(cleanTextForBlockType("- [x] done", "todo")).toBe("done");
    expect(cleanTextForBlockType("1. Item", "ordered_list")).toBe("Item");
    expect(cleanTextForBlockType("```database query=project", "database_view")).toBe(
      "project"
    );
    expect(cleanTextForBlockType("$$ E = mc^2 $$", "math")).toBe("E = mc^2");
    expect(cleanTextForBlockType("text", "divider")).toBe("");
    expect(
      cleanTextForBlockType("![Cat](https://example.com/cat.png)", "image")
    ).toBe("https://example.com/cat.png");
  });

  it("toggles todo text check state", () => {
    expect(isTodoChecked("- [x] done")).toBe(true);
    expect(toggleTodoText("- [ ] task", true)).toBe("- [x] task");
    expect(toggleTodoText("- [x] task", false)).toBe("- [ ] task");
    expect(toggleTodoText("task", true)).toBe("- [x] task");
  });

  it("resolves markdown headings for rendering without overriding non-text typed blocks", () => {
    expect(resolveRenderBlockType({ text: "# Title", block_type: "text" })).toBe(
      "heading1"
    );
    expect(resolveRenderBlockType({ text: "## Title", block_type: "heading1" })).toBe(
      "heading2"
    );
    expect(
      resolveRenderBlockType({ text: "# Title", block_type: "quote" })
    ).toBe("quote");
  });

  it("normalizes database language blocks and extracts queries", () => {
    expect(formatDatabaseBlockText("project alpha")).toBe("```database project alpha");
    expect(formatDatabaseBlockText("```database query=project alpha")).toBe(
      "```database project alpha"
    );
    expect(extractDatabaseQuery("```database project alpha")).toBe("project alpha");
    expect(
      extractDatabaseQuery("```database\nquery: inbox\n```")
    ).toBe("inbox");
  });
});
