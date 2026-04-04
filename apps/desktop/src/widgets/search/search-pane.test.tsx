import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { vi } from "vitest";
import type { SearchResult } from "../../entities/search/model/search-types";
import { SearchPane } from "./search-pane";

describe("SearchPane", () => {
  it("renders accessible recent search and results listboxes", async () => {
    const [query, setQuery] = createSignal("Draft");
    const [history] = createSignal(["Draft line 2"]);
    const [results] = createSignal<SearchResult[]>([
      { id: "block-1", text: "Draft line 1" }
    ]);
    const commitTerm = vi.fn();
    const applyTerm = vi.fn();
    const onResultSelect = vi.fn();
    const user = userEvent.setup();

    render(() => (
      <SearchPane
        query={query}
        setQuery={setQuery}
        commitTerm={commitTerm}
        history={history}
        applyTerm={applyTerm}
        results={results}
        onResultSelect={onResultSelect}
        renderHighlight={(text) => text}
      />
    ));

    const historyListbox = screen.getByRole("listbox", { name: "Recent searches" });
    const resultsListbox = screen.getByRole("listbox", { name: "Search results" });

    await user.click(within(historyListbox).getByRole("option", { name: "Draft line 2" }));
    expect(applyTerm).toHaveBeenCalledWith("Draft line 2");

    await user.click(within(resultsListbox).getByRole("option", { name: "Draft line 1" }));
    expect(onResultSelect).toHaveBeenCalledWith({ id: "block-1", text: "Draft line 1" });
  });
});
