import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type {
  SearchAnswerResult,
  SearchMode,
  SearchResult
} from "../../entities/search/model/search-types";
import { SearchPane } from "./search-pane";

describe("SearchPane", () => {
  it("renders accessible recent search and results listboxes", async () => {
    const [query, setQuery] = createSignal("Draft");
    const [mode, setMode] = createSignal<SearchMode>("lexical");
    const [answer] = createSignal<SearchAnswerResult | null>(null);
    const [history] = createSignal(["Draft line 2"]);
    const [results] = createSignal<SearchResult[]>([
      {
        id: "block-1",
        text: "Draft line 1",
        title: "Inbox",
        breadcrumb: "Project",
        source: "lexical"
      }
    ]);
    const commitTerm = vi.fn();
    const applyTerm = vi.fn();
    const onResultSelect = vi.fn();
    const onCitationSelect = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SearchPane
        mode={mode}
        setMode={setMode}
        answer={answer}
        query={query}
        setQuery={setQuery}
        commitTerm={commitTerm}
        history={history}
        applyTerm={applyTerm}
        results={results}
        onResultSelect={onResultSelect}
        onCitationSelect={onCitationSelect}
        renderHighlight={(text) => text}
      />
    ));

    const historyListbox = screen.getByRole("listbox", { name: "Recent searches" });
    const resultsListbox = screen.getByRole("listbox", { name: "Search results" });
    expect(screen.getByText("Inbox · Project · Indexed lexical")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Hybrid" }));
    expect(mode()).toBe("hybrid");

    await user.click(within(historyListbox).getByRole("option", { name: "Draft line 2" }));
    expect(applyTerm).toHaveBeenCalledWith("Draft line 2");

    await user.click(within(resultsListbox).getByRole("option", { name: "Draft line 1" }));
    expect(onResultSelect).toHaveBeenCalledWith({
      id: "block-1",
      text: "Draft line 1",
      title: "Inbox",
      breadcrumb: "Project",
      source: "lexical"
    });
  });

  it("renders answer mode citations", async () => {
    const [query, setQuery] = createSignal("Draft");
    const [mode, setMode] = createSignal<SearchMode>("answer");
    const [answer] = createSignal<SearchAnswerResult | null>({
      answer: "Answer line",
      citations: [
        {
          pageUid: "page-1",
          blockUid: "block-1",
          chunkId: "chunk-1",
          title: "Inbox",
          breadcrumb: "Project",
          snippet: "Draft line 1",
          rank: 1
        }
      ],
      usedChunks: ["chunk-1"],
      latencyMs: 0,
      provider: "local",
      model: "extractive-answer-v1"
    });
    const [history] = createSignal<string[]>([]);
    const [results] = createSignal<SearchResult[]>([]);
    const onCitationSelect = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SearchPane
        mode={mode}
        setMode={setMode}
        answer={answer}
        query={query}
        setQuery={setQuery}
        commitTerm={() => {}}
        history={history}
        applyTerm={() => {}}
        results={results}
        onResultSelect={() => {}}
        onCitationSelect={onCitationSelect}
        renderHighlight={(text) => text}
      />
    ));

    expect(screen.getByText("Answer line")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Draft line 1/i }));
    expect(onCitationSelect).toHaveBeenCalledWith({
      pageUid: "page-1",
      blockUid: "block-1",
      chunkId: "chunk-1",
      title: "Inbox",
      breadcrumb: "Project",
      snippet: "Draft line 1",
      rank: 1
    });
  });
});
