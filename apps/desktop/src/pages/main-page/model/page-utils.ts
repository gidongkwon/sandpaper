import type { LocalPageRecord } from "../../../entities/page/model/page-types";

export const formatBacklinkSnippet = (text: string) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled";
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 80)}...`;
};

export const stripWikilinks = (text: string) =>
  text.replace(/\[\[[^\]]+?\]\]/g, "");

export const resolveUniqueLocalPageUid = (
  title: string,
  localPages: Record<string, LocalPageRecord>,
  resolvePageUid: (value: string) => string
) => {
  const base = resolvePageUid(title);
  let candidate = base;
  let counter = 2;
  while (localPages[candidate]) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
};

export const formatDailyNoteTitle = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
