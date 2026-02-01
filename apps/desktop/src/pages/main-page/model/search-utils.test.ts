import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../../entities/search/model/search-types";
import { commitSearchHistory, filterSearchResults } from "./search-utils";

describe("search utils", () => {
  const results: SearchResult[] = [
    { id: "1", text: "Link [[Page]]" },
    { id: "2", text: "Task [ ] do thing" },
    { id: "3", text: "Pinned #pin for later" },
    { id: "4", text: "Plain text" }
  ];

  it("filters results by kind", () => {
    expect(filterSearchResults(results, "links")).toHaveLength(1);
    expect(filterSearchResults(results, "tasks")).toHaveLength(1);
    expect(filterSearchResults(results, "pinned")).toHaveLength(1);
    expect(filterSearchResults(results, "all")).toHaveLength(results.length);
  });

  it("commits search history with normalization and cap", () => {
    const history = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
    expect(commitSearchHistory(history, "Beta")).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
      "Delta",
      "Epsilon"
    ]);

    expect(commitSearchHistory(history, "Foxtrot")).toEqual([
      "Foxtrot",
      "Alpha",
      "Beta",
      "Gamma",
      "Delta"
    ]);
  });
});
