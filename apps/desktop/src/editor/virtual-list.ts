export type VirtualRangeParams = {
  count: number;
  rowHeight: number;
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

export const getVirtualRange = ({
  count,
  rowHeight,
  overscan,
  scrollTop,
  viewportHeight
}: VirtualRangeParams): VirtualRange => {
  if (count <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0, offset: 0, totalHeight: Math.max(0, count) * rowHeight };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const totalHeight = count * rowHeight;
  const visibleStart = Math.floor(safeScrollTop / rowHeight);
  const visibleEnd = Math.ceil((safeScrollTop + viewportHeight) / rowHeight);

  const start = Math.max(0, visibleStart - overscan);
  const end = Math.min(count, visibleEnd + overscan);
  const offset = start * rowHeight;

  return { start, end, offset, totalHeight };
};
