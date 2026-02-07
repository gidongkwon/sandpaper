import { describe, expect, it } from "vitest";
import { parseInlineFence } from "./inline-parser";

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
});
