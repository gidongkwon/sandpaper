import { render, screen, waitFor } from "@solidjs/testing-library";
import { createEffect } from "solid-js";
import { vi } from "vitest";
import { createSearchState } from "./use-search";

describe("createSearchState", () => {
  it("defaults to hybrid search mode", () => {
    render(() => {
      const state = createSearchState({
        blocks: () => [],
        isTauri: () => false,
        invoke: vi.fn(),
        historyKey: () => "default-mode-test",
        focusInput: () => {}
      });

      return <div>{state.searchMode()}</div>;
    });

    expect(screen.getByText("hybrid")).toBeInTheDocument();
  });

  it("wraps hybrid rag search payloads for tauri commands", async () => {
    const invoke = vi.fn().mockResolvedValue([
      {
        page_uid: "page-1",
        block_uid: "block-1",
        chunk_id: "chunk-1",
        title: "Inbox",
        breadcrumb: "Project",
        snippet: "Draft line 1"
      }
    ]);

    render(() => {
      const state = createSearchState({
        blocks: () => [],
        isTauri: () => true,
        invoke,
        historyKey: () => "search-test",
        focusInput: () => {}
      });

      createEffect(() => {
        state.setSearchQuery("Draft");
      });

      return <div>{state.filteredSearchResults().length}</div>;
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rag_search_hybrid", {
        payload: {
          query: "Draft",
          limit: 20
        }
      });
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });

  it("wraps answer payloads for tauri commands", async () => {
    const invoke = vi.fn().mockResolvedValue({
      answer: "Answer line",
      citations: [],
      used_chunks: [],
      latency_ms: 0,
      provider: "local",
      model: "extractive-answer-v1"
    });

    render(() => {
      const state = createSearchState({
        blocks: () => [],
        isTauri: () => true,
        invoke,
        historyKey: () => "answer-test",
        focusInput: () => {}
      });

      createEffect(() => {
        state.setSearchMode("answer");
        state.setSearchQuery("Draft");
      });

      return <div>{state.searchAnswer()?.answer ?? ""}</div>;
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rag_answer_query", {
        payload: {
          query: "Draft",
          limit: 10
        }
      });
      expect(screen.getByText("Answer line")).toBeInTheDocument();
    });
  });
});
