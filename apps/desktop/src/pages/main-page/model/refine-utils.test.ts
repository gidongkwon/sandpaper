import { describe, expect, it } from "vitest";
import { formatRefineDate } from "./refine-utils";

describe("refine utils", () => {
  it("returns a placeholder for missing timestamps", () => {
    expect(formatRefineDate(null)).toBe("—");
  });

  it("formats a timestamp with a custom formatter", () => {
    const formatter = { format: () => "formatted" } as Intl.DateTimeFormat;
    expect(formatRefineDate(Date.UTC(2026, 0, 1, 12, 0, 0), formatter)).toBe(
      "formatted"
    );
  });
});
