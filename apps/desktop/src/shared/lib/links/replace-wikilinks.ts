import { normalizePageUid } from "../page/normalize-page-uid";

export const replaceWikilinksInText = (
  text: string,
  fromTitle: string,
  toTitle: string
) => {
  const normalizedFrom = normalizePageUid(fromTitle);
  const normalizedTo = normalizePageUid(toTitle);
  if (!normalizedFrom || normalizedFrom === normalizedTo) return text;
  return text.replace(/\[\[[^\]]+?\]\]/g, (token) => {
    const inner = token.slice(2, -2);
    const raw = inner.trim();
    if (!raw) return token;
    const [targetPart, aliasPart] = raw.split("|");
    const [targetBase, headingPart] = targetPart.split("#");
    const targetTitle = targetBase.trim();
    if (!targetTitle) return token;
    if (normalizePageUid(targetTitle) !== normalizedFrom) return token;
    const nextTarget = toTitle.trim() || targetTitle;
    const headingSuffix = headingPart ? `#${headingPart.trim()}` : "";
    const aliasSuffix = aliasPart ? `|${aliasPart.trim()}` : "";
    return `[[${nextTarget}${headingSuffix}${aliasSuffix}]]`;
  });
};
