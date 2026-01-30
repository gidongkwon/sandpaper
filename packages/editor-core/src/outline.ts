export type OutlineBlock = {
  id: string;
  text: string;
  indent: number;
};

export const createBlock = (id: string, text: string, indent: number): OutlineBlock => ({
  id,
  text,
  indent
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getSubtreeRange = (blocks: OutlineBlock[], index: number) => {
  const baseIndent = blocks[index]?.indent ?? 0;
  let end = index + 1;
  while (end < blocks.length && blocks[end].indent > baseIndent) {
    end += 1;
  }
  return { start: index, end };
};

export const splitBlock = (
  blocks: OutlineBlock[],
  index: number,
  cursor: number,
  newId: string
) => {
  if (index < 0 || index >= blocks.length) {
    return { blocks, newIndex: index };
  }
  const target = blocks[index];
  const safeCursor = clamp(cursor, 0, target.text.length);
  const left = target.text.slice(0, safeCursor);
  const right = target.text.slice(safeCursor);

  const next = blocks.slice();
  next[index] = { ...target, text: left };
  next.splice(index + 1, 0, {
    id: newId,
    text: right,
    indent: target.indent
  });

  return { blocks: next, newIndex: index + 1 };
};

export const mergeBlockWithPrevious = (blocks: OutlineBlock[], index: number) => {
  if (index <= 0 || index >= blocks.length) {
    return { blocks, mergedIndex: index };
  }
  const prev = blocks[index - 1];
  const current = blocks[index];
  const next = blocks.slice(0, index - 1);
  next.push({ ...prev, text: `${prev.text}${current.text}` });
  next.push(...blocks.slice(index + 1));
  return { blocks: next, mergedIndex: index - 1 };
};

const shiftIndent = (
  blocks: OutlineBlock[],
  start: number,
  end: number,
  delta: number
) => {
  return blocks.map((block, idx) => {
    if (idx < start || idx >= end) return block;
    return { ...block, indent: Math.max(0, block.indent + delta) };
  });
};

export const indentBlock = (blocks: OutlineBlock[], index: number) => {
  if (index <= 0 || index >= blocks.length) return blocks;
  const prevIndent = blocks[index - 1].indent;
  const currentIndent = blocks[index].indent;
  const nextIndent = Math.min(currentIndent + 1, prevIndent + 1);
  const delta = nextIndent - currentIndent;
  if (delta === 0) return blocks;

  const range = getSubtreeRange(blocks, index);
  return shiftIndent(blocks, range.start, range.end, delta);
};

export const outdentBlock = (blocks: OutlineBlock[], index: number) => {
  if (index < 0 || index >= blocks.length) return blocks;
  const currentIndent = blocks[index].indent;
  if (currentIndent === 0) return blocks;

  const range = getSubtreeRange(blocks, index);
  return shiftIndent(blocks, range.start, range.end, -1);
};

export const moveBlockRange = (
  blocks: OutlineBlock[],
  fromIndex: number,
  toIndex: number
) => {
  if (fromIndex < 0 || fromIndex >= blocks.length) return blocks;
  const range = getSubtreeRange(blocks, fromIndex);
  const slice = blocks.slice(range.start, range.end);
  const remaining = blocks.slice(0, range.start).concat(blocks.slice(range.end));

  let insertIndex = toIndex;
  if (toIndex > range.start) {
    insertIndex = toIndex - (range.end - range.start);
  }
  insertIndex = clamp(insertIndex, 0, remaining.length);

  return remaining.slice(0, insertIndex).concat(slice, remaining.slice(insertIndex));
};
