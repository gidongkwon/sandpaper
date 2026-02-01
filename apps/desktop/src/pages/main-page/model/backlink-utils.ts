import type { BacklinkEntry } from "../../../entities/page/model/backlink-types";

export const getPageBacklinkSource = (
  entry: BacklinkEntry,
  currentUid: string,
  resolvePageUid: (value: string) => string
) => {
  const sourceUid = resolvePageUid(entry.pageUid || currentUid);
  if (sourceUid === resolvePageUid(currentUid)) return "This page";
  return entry.pageTitle || "Untitled page";
};

export const groupPageBacklinks = (
  entries: BacklinkEntry[],
  currentUid: string,
  resolvePageUid: (value: string) => string
) => {
  const groups = new Map<string, { title: string; entries: BacklinkEntry[] }>();
  entries.forEach((entry) => {
    const key = resolvePageUid(entry.pageUid || entry.pageTitle || "page");
    const title = getPageBacklinkSource(entry, currentUid, resolvePageUid);
    if (!groups.has(key)) {
      groups.set(key, { title, entries: [] });
    }
    groups.get(key)?.entries.push(entry);
  });
  return Array.from(groups.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
};
