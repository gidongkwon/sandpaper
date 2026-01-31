const BLOCK_REF_PATTERN = /\(\(([a-zA-Z0-9_-]+)\)\)/g;

export const extractBlockRefs = (text: string): string[] => {
  const refs = new Set<string>();
  for (const match of text.matchAll(BLOCK_REF_PATTERN)) {
    if (match[1]) {
      refs.add(match[1]);
    }
  }
  return Array.from(refs);
};

export const buildBacklinks = (
  blocks: Array<{ id: string; text: string }>
): Record<string, string[]> => {
  const map: Record<string, string[]> = {};

  blocks.forEach((block) => {
    const refs = extractBlockRefs(block.text);
    refs.forEach((ref) => {
      if (!map[ref]) {
        map[ref] = [];
      }
      if (!map[ref].includes(block.id)) {
        map[ref].push(block.id);
      }
    });
  });

  Object.keys(map).forEach((key) => {
    map[key].sort();
  });

  return map;
};
