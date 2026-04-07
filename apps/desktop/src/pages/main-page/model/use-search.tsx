import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type Accessor,
  type JSX
} from "solid-js";
import type { Block } from "../../../entities/block/model/block-types";
import type {
  SearchAnswerResult,
  SearchMode,
  SearchResult
} from "../../../entities/search/model/search-types";
import { escapeRegExp } from "../../../shared/lib/string/escape-regexp";
import {
  readLocalStorage,
  writeLocalStorage
} from "../../../shared/lib/storage/safe-local-storage";
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
  const [searchMode, setSearchMode] = createSignal<SearchMode>("hybrid");
  const [searchFilter, setSearchFilter] = createSignal<SearchFilter>("all");
  const [searchHistory, setSearchHistory] = createSignal<string[]>([]);

  const localSearch = (query: string): SearchResult[] => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return deps
      .blocks()
      .filter((block) => block.text.toLowerCase().includes(normalized))
      .slice(0, 12)
      .map((block) => ({
        id: block.id,
        text: block.text,
        blockUid: block.id,
        source: "local"
      }));
  };

  const localResults = createMemo<SearchResult[]>(() => {
    const trimmed = searchQuery().trim();
    if (!trimmed) return [];
    if (searchMode() === "answer") return [];
    return localSearch(trimmed);
  });

  const [remoteResults] = createResource(
    () => ({ query: searchQuery(), mode: searchMode() }),
    async ({ query, mode }) => {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (mode === "answer") return [];
      if (!deps.isTauri()) return [];

      try {
        const command =
          mode === "vector"
            ? "rag_search_vector"
            : mode === "hybrid"
              ? "rag_search_hybrid"
              : "rag_search_lex";
        const remote = (await deps.invoke(command, {
          payload: {
            query: trimmed,
            limit: 20
          }
        })) as
          | Array<{
              page_uid: string;
              block_uid: string;
              chunk_id: string;
              title: string;
              breadcrumb?: string | null;
              snippet: string;
            }>
          | null;
        if (remote && remote.length > 0) {
          return remote.map((hit) => ({
            id: hit.block_uid,
            text: hit.snippet,
            title: hit.title,
            pageUid: hit.page_uid,
            blockUid: hit.block_uid,
            breadcrumb: hit.breadcrumb ?? null,
            source: mode
          }));
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

  const [remoteAnswer] = createResource(
    () => ({ query: searchQuery(), mode: searchMode() }),
    async ({ query, mode }) => {
      const trimmed = query.trim();
      if (!trimmed) return null;
      if (mode !== "answer") return null;
      if (!deps.isTauri()) return null;

      try {
        const remote = (await deps.invoke("rag_answer_query", {
          payload: {
            query: trimmed,
            limit: 10
          }
        })) as
          | {
              answer: string;
              citations: Array<{
                page_uid: string;
                block_uid: string;
                chunk_id: string;
                title: string;
                breadcrumb?: string | null;
                snippet: string;
                rank: number;
              }>;
              used_chunks: string[];
              latency_ms: number;
              provider: string;
              model: string;
            }
          | null;
        if (!remote) return null;
        return {
          answer: remote.answer,
          citations: remote.citations.map((citation) => ({
            pageUid: citation.page_uid,
            blockUid: citation.block_uid,
            chunkId: citation.chunk_id,
            title: citation.title,
            breadcrumb: citation.breadcrumb ?? null,
            snippet: citation.snippet,
            rank: citation.rank
          })),
          usedChunks: remote.used_chunks,
          latencyMs: remote.latency_ms,
          provider: remote.provider,
          model: remote.model
        } satisfies SearchAnswerResult;
      } catch (error) {
        console.error("Answer query failed", error);
        return {
          answer: "Answer generation failed.",
          citations: [],
          usedChunks: [],
          latencyMs: 0,
          provider: "local",
          model: "error"
        } satisfies SearchAnswerResult;
      }
    },
    { initialValue: null }
  );

  const searchAnswer = createMemo<SearchAnswerResult | null>(() =>
    searchMode() === "answer" ? remoteAnswer() : null
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
    const stored = readLocalStorage(key);
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
    writeLocalStorage(key, JSON.stringify(searchHistory()));
  });

  return {
    searchQuery,
    setSearchQuery,
    searchMode,
    setSearchMode,
    searchFilter,
    setSearchFilter,
    searchHistory,
    filteredSearchResults,
    searchAnswer,
    commitSearchTerm,
    applySearchTerm,
    renderSearchHighlight
  };
};
