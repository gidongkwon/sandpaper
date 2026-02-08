import { describe, expect, it } from "vitest";
import {
  parseInlineFence,
  parseMarkdownTable,
  rewriteInlineFenceLanguage
} from "./inline-parser";

describe("parseInlineFence", () => {
  it("parses single-line inline fences", () => {
    expect(parseInlineFence("```ts const x = 1")).toEqual({
      lang: "ts",
      content: "const x = 1"
    });
  });

  it("parses multiline fences and strips the closing fence", () => {
    expect(parseInlineFence("```ts\nconst x = 1\n```")).toEqual({
      lang: "ts",
      content: "const x = 1"
    });
  });

  it("parses empty inline and multiline fences", () => {
    expect(parseInlineFence("```ts")).toEqual({
      lang: "ts",
      content: ""
    });
    expect(parseInlineFence("```ts\n```")).toEqual({
      lang: "ts",
      content: ""
    });
  });
});

describe("rewriteInlineFenceLanguage", () => {
  it("rewrites the language for inline fences", () => {
    expect(rewriteInlineFenceLanguage("```js const x = 1", "ts")).toBe(
      "```ts const x = 1"
    );
  });

  it("rewrites the language for multiline fences", () => {
    expect(rewriteInlineFenceLanguage("```js\nconst x = 1\n```", "ts")).toBe(
      "```ts\nconst x = 1\n```"
    );
  });
});

describe("parseMarkdownTable", () => {
  it("parses a markdown table with header and body rows", () => {
    expect(
      parseMarkdownTable(
        "| Name | Qty |\n| --- | --- |\n| Pencil | 2 |\n| Pen | 5 |"
      )
    ).toEqual({
      headers: ["Name", "Qty"],
      rows: [
        ["Pencil", "2"],
        ["Pen", "5"]
      ]
    });
  });

  it("returns null for invalid table markdown", () => {
    expect(parseMarkdownTable("| Name | Qty |\n| Pencil | 2 |")).toBeNull();
  });
});
