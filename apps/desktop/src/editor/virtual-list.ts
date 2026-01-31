export type VirtualRangeParams = {
  count: number;
  rowHeight: number;
  rowHeights?: number[];
  rowOffsets?: number[];
  totalHeight?: number;
  overscan: number;
  scrollTop: number;
  viewportHeight: number;
};

export type VirtualRange = {
  start: number;
  end: number;
  offset: number;
  totalHeight: number;
};

const buildOffsets = (heights: number[]) => {
  const offsets = new Array<number>(heights.length);
  let total = 0;
  for (let i = 0; i < heights.length; i += 1) {
    offsets[i] = total;
    total += heights[i];
  }
  return { offsets, total };
};

const findIndexAtOffset = (offsets: number[], target: number) => {
  if (offsets.length === 0) return 0;
  const clamped = Math.max(0, target);
  let low = 0;
  let high = offsets.length - 1;
  let result = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = offsets[mid];
    if (value <= clamped) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
};

export const getVirtualRange = ({
  count,
  rowHeight,
  rowHeights,
  rowOffsets,
  totalHeight,
  overscan,
  scrollTop,
  viewportHeight
}: VirtualRangeParams): VirtualRange => {
  if (count <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0, offset: 0, totalHeight: Math.max(0, count) * rowHeight };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  if (rowHeights && rowHeights.length === count) {
    const heights = rowHeights.map((height) =>
      Math.max(0, Number.isFinite(height) ? height : rowHeight)
    );
    const offsets =
      rowOffsets && rowOffsets.length === count
        ? rowOffsets
        : buildOffsets(heights).offsets;
    const listHeight =
      totalHeight ?? offsets[count - 1] + (heights[count - 1] ?? rowHeight);
    const visibleStart = findIndexAtOffset(offsets, safeScrollTop);
    const visibleEnd = findIndexAtOffset(offsets, safeScrollTop + viewportHeight);
    const start = Math.max(0, visibleStart - overscan);
    const end = Math.min(count, visibleEnd + overscan + 1);
    const offset = offsets[start] ?? 0;
    return { start, end, offset, totalHeight: listHeight };
  }

  const listHeight = count * rowHeight;
  const visibleStart = Math.floor(safeScrollTop / rowHeight);
  const visibleEnd = Math.ceil((safeScrollTop + viewportHeight) / rowHeight);

  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(count, visibleEnd + overscan);
  const offset = start * rowHeight;

  return { start, end, offset, totalHeight: listHeight };
};
