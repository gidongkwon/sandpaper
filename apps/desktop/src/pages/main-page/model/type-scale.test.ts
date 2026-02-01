import { describe, expect, it } from "vitest";
import {
  TYPE_SCALE_DEFAULT,
  TYPE_SCALE_DEFAULT_POSITION,
  TYPE_SCALE_MAX,
  TYPE_SCALE_MIN,
  resolveStoredTypeScale
} from "./type-scale";

describe("type scale", () => {
  it("resolves stored values within bounds", () => {
    expect(resolveStoredTypeScale("1.2")).toBe(1.2);
    expect(resolveStoredTypeScale("2")).toBeNull();
    expect(resolveStoredTypeScale("abc")).toBeNull();
  });

  it("exports sane default bounds", () => {
    expect(TYPE_SCALE_MIN).toBeLessThan(TYPE_SCALE_MAX);
    expect(TYPE_SCALE_DEFAULT).toBeGreaterThanOrEqual(TYPE_SCALE_MIN);
    expect(TYPE_SCALE_DEFAULT).toBeLessThanOrEqual(TYPE_SCALE_MAX);
    expect(TYPE_SCALE_DEFAULT_POSITION).toMatch(/%$/);
  });
});
