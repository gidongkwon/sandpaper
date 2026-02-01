import { replaceWikilinksInText } from "../../../shared/lib/links/replace-wikilinks";

export const updateBlocksWithWikilinks = <T extends { text: string }>(
  source: T[],
  fromTitle: string,
  toTitle: string
) => {
  let changed = false;
  const updated = source.map((block) => {
    const nextText = replaceWikilinksInText(block.text, fromTitle, toTitle);
    if (nextText === block.text) return block;
    changed = true;
    return { ...block, text: nextText };
  });
  return { updated, changed };
};
