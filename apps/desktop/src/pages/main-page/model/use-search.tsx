import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type Accessor,
  type JSX
} from "solid-js";
import type { Block, BlockSearchResult } from "../../../entities/block/model/block-types";
import type { SearchResult } from "../../../entities/search/model/search-types";
import { escapeRegExp } from "../../../shared/lib/string/escape-regexp";
import {
  commitSearchHistory,
  filterSearchResults,
  type SearchFilter
} from "./search-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type SearchDeps = {
  blocks: Accessor<Block[]>;
  isTauri: () => boolean;
  invoke: InvokeFn;
  historyKey: Accessor<string>;
  focusInput: () => void;
};

export const createSearchState = (deps: SearchDeps) => {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchFilter, setSearchFilter] = createSignal<SearchFilter>("all");
  const [searchHistory, setSearchHistory] = createSignal<string[]>([]);

  const localSearch = (query: string): SearchResult[] => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return deps
      .blocks()
      .filter((block) => block.text.toLowerCase().includes(normalized))
      .slice(0, 12)
      .map((block) => ({ id: block.id, text: block.text }));
  };

  const localResults = createMemo<SearchResult[]>(() => {
    const trimmed = searchQuery().trim();
    if (!trimmed) return [];
    return localSearch(trimmed);
  });

  const [remoteResults] = createResource(
    searchQuery,
    async (query) => {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (!deps.isTauri()) return [];

      try {
        const remote = (await deps.invoke("search_blocks", {
          query: trimmed
        })) as BlockSearchResult[] | null;
        if (remote && remote.length > 0) {
          return remote.map((block) => ({ id: block.uid, text: block.text }));
        }
      } catch (error) {
        console.error("Search failed", error);
      }

      return [];
    },
    { initialValue: [] }
  );

  const searchResults = createMemo<SearchResult[]>(() =>
    deps.isTauri() ? remoteResults() : localResults()
  );

  const filteredSearchResults = createMemo<SearchResult[]>(() =>
    filterSearchResults(searchResults(), searchFilter())
  );

  const commitSearchTerm = (term: string) => {
    setSearchHistory((prev) => commitSearchHistory(prev, term));
  };

  const applySearchTerm = (term: string) => {
    setSearchQuery(term);
    deps.focusInput();
  };

  const renderSearchHighlight = (
    text: string
  ): Array<string | JSX.Element> | string => {
    const query = searchQuery().trim();
    if (!query) return text;
    const escaped = escapeRegExp(query);
    if (!escaped) return text;
    const regex = new RegExp(escaped, "gi");
    const nodes: Array<string | JSX.Element> = [];
    let lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        nodes.push(text.slice(lastIndex, index));
      }
      nodes.push(<mark class="search-highlight">{match[0]}</mark>);
      lastIndex = index + match[0].length;
    }
    if (nodes.length === 0) return text;
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }
    return nodes;
  };

  createEffect(() => {
    const key = deps.historyKey();
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(key);
    if (!stored) {
      setSearchHistory([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      setSearchHistory(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSearchHistory([]);
    }
  });

  createEffect(() => {
    const key = deps.historyKey();
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(searchHistory()));
  });

  return {
    searchQuery,
    setSearchQuery,
    searchFilter,
    setSearchFilter,
    searchHistory,
    filteredSearchResults,
    commitSearchTerm,
    applySearchTerm,
    renderSearchHighlight
  };
};
