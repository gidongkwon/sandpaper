import { describe, expect, it } from "vitest";
import { getVirtualRange } from "./virtual-list";

describe("getVirtualRange", () => {
  it("calculates the visible range at the top", () => {
    const range = getVirtualRange({
      count: 100,
      rowHeight: 40,
      overscan: 2,
      scrollTop: 0,
      viewportHeight: 200
    });

    expect(range).toEqual({
      start: 0,
      end: 7,
      offset: 0,
      totalHeight: 4000
    });
  });

  it("applies overscan for a middle scroll position", () => {
    const range = getVirtualRange({
      count: 100,
      rowHeight: 40,
      overscan: 2,
      scrollTop: 400,
      viewportHeight: 200
    });

    expect(range.start).toBe(8);
    expect(range.end).toBe(17);
    expect(range.offset).toBe(320);
  });

  it("clamps range to the list end", () => {
    const range = getVirtualRange({
      count: 50,
      rowHeight: 40,
      overscan: 2,
      scrollTop: 1800,
      viewportHeight: 200
    });

    expect(range.start).toBe(43);
    expect(range.end).toBe(50);
    expect(range.offset).toBe(1720);
  });

  it("handles empty lists", () => {
    const range = getVirtualRange({
      count: 0,
      rowHeight: 40,
      overscan: 2,
      scrollTop: 0,
      viewportHeight: 200
    });

    expect(range).toEqual({
      start: 0,
      end: 0,
      offset: 0,
      totalHeight: 0
    });
  });

  it("keeps the render window small for large lists", () => {
    const rowHeight = 44;
    const overscan = 6;
    const viewportHeight = 720;
    const range = getVirtualRange({
      count: 50000,
      rowHeight,
      overscan,
      scrollTop: 12000,
      viewportHeight
    });

    const visibleRows = Math.ceil(viewportHeight / rowHeight);
    expect(range.end - range.start).toBeLessThanOrEqual(
      visibleRows + overscan * 2 + 1
    );
    expect(range.totalHeight).toBe(rowHeight * 50000);
  });
});
