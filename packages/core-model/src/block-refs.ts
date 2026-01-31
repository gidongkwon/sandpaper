const BLOCK_REF_PATTERN = /\(\(([a-zA-Z0-9_-]+)\)\)/g;
const WIKI_LINK_PATTERN = /\[\[([^\]]+?)\]\]/g;

export const extractBlockRefs = (text: string): string[] => {
  const refs = new Set<string>();
  for (const match of text.matchAll(BLOCK_REF_PATTERN)) {
    if (match[1]) {
      refs.add(match[1]);
    }
  }
  return Array.from(refs);
};

const normalizeWikiTarget = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [beforeAlias] = trimmed.split("|");
  const [beforeHeading] = beforeAlias.split("#");
  const title = beforeHeading.trim();
  if (!title) return null;
  return title;
};

export const extractWikiLinks = (text: string): string[] => {
  const links = new Set<string>();
  for (const match of text.matchAll(WIKI_LINK_PATTERN)) {
    const target = match[1] ? normalizeWikiTarget(match[1]) : null;
    if (target) {
      links.add(target);
    }
  }
  return Array.from(links);
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

export const buildWikilinkBacklinks = (
  blocks: Array<{ id: string; text: string }>,
  normalize: (value: string) => string = (value) => value
): Record<string, string[]> => {
  const map: Record<string, string[]> = {};

  blocks.forEach((block) => {
    const links = extractWikiLinks(block.text);
    links.forEach((link) => {
      const target = normalize(link);
      if (!target) return;
      if (!map[target]) {
        map[target] = [];
      }
      if (!map[target].includes(block.id)) {
        map[target].push(block.id);
      }
    });
  });

  Object.keys(map).forEach((key) => {
    map[key].sort();
  });

  return map;
};
