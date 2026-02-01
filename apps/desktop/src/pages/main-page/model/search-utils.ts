import type { SearchResult } from "../../../entities/search/model/search-types";

export type SearchFilter = "all" | "links" | "tasks" | "pinned";

export const filterSearchResults = (
  results: SearchResult[],
  filter: SearchFilter
) => {
  if (filter === "all") return results;
  if (filter === "links") {
    return results.filter(
      (result) => result.text.includes("((") || result.text.includes("[[")
    );
  }
  if (filter === "tasks") {
    return results.filter((result) => /\[\s?[xX ]\s?\]/.test(result.text));
  }
  if (filter === "pinned") {
    return results.filter((result) =>
      result.text.toLowerCase().includes("#pin")
    );
  }
  return results;
};

export const commitSearchHistory = (history: string[], term: string) => {
  const trimmed = term.trim();
  if (!trimmed) return history;
  const normalized = trimmed.toLowerCase();
  const next = [
    trimmed,
    ...history.filter((item) => item.toLowerCase() !== normalized)
  ];
  return next.slice(0, 5);
};
