import { describe, expect, it } from "vitest";
import { formatReviewDate } from "./review-utils";

describe("review utils", () => {
  it("returns a placeholder for missing timestamps", () => {
    expect(formatReviewDate(null)).toBe("—");
  });

  it("formats a timestamp with a custom formatter", () => {
    const formatter = { format: () => "formatted" } as Intl.DateTimeFormat;
    expect(formatReviewDate(Date.UTC(2026, 0, 1, 12, 0, 0), formatter)).toBe(
      "formatted"
    );
  });
});
