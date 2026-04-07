import { Show, createMemo, type Accessor, type JSX, type Setter } from "solid-js";
import type {
  SearchAnswerResult,
  SearchCitation,
  SearchMode,
  SearchResult
} from "../../entities/search/model/search-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { Search16Icon } from "../../shared/ui/icons";
import { ActionListbox, type ActionListboxOption } from "../../shared/ui/action-listbox";
import { SegmentedTabs } from "../../shared/ui/segmented-tabs";
import { TextField } from "../../shared/ui/text-field";

type SearchPaneProps = {
  mode: Accessor<SearchMode>;
  setMode: Setter<SearchMode>;
  answer: Accessor<SearchAnswerResult | null>;
  searchInputRef?: (el: HTMLInputElement) => void;
  query: Accessor<string>;
  setQuery: Setter<string>;
  commitTerm: (value: string) => void;
  history: Accessor<string[]>;
  applyTerm: (term: string) => void;
  results: Accessor<SearchResult[]>;
  onResultSelect: (block: SearchResult) => void;
  onCitationSelect: (citation: SearchCitation) => void;
  renderHighlight: (text: string) => JSX.Element;
  children?: JSX.Element;
};

export const SearchPane = (props: SearchPaneProps) => {
  const modeItems = [
    { value: "hybrid", label: "Search" },
    { value: "answer", label: "Answer" }
  ] as const;

  const citationOptions = createMemo<ActionListboxOption<SearchCitation>[]>(() =>
    (props.answer()?.citations ?? []).map((citation) => ({
      value: citation.chunkId,
      label: citation.snippet,
      description: [citation.title, citation.breadcrumb].filter(Boolean).join(" · "),
      data: citation
    }))
  );

  const historyOptions = createMemo<ActionListboxOption<string>[]>(() =>
    props.history().map((term) => ({
      value: term,
      label: term,
      data: term
    }))
  );
  const resultOptions = createMemo<ActionListboxOption<SearchResult>[]>(() =>
    props.results().map((result) => ({
      value: result.id,
      label: result.text || "Untitled",
      description: result.breadcrumb?.trim() || null,
      data: result
    }))
  );

  return (
    <>
      <div class="sidebar__header">
        <SegmentedTabs
          value={props.mode()}
          onChange={props.setMode}
          items={modeItems}
          aria-label="Search mode"
          class="sidebar__segmented-tabs"
        />
        <div class="sidebar__search">
          <Search16Icon class="sidebar__search-icon" width="14" height="14" />
          <TextField
            ref={(el) => props.searchInputRef?.(el)}
            class="sidebar__input"
            type="search"
            aria-label="Search"
            placeholder="Search..."
            value={props.query()}
            onInput={(event) => props.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.commitTerm(event.currentTarget.value);
              }
            }}
          />
        </div>
      </div>

      <div class="sidebar__content">
        <Show when={props.history().length > 0}>
          <div class="sidebar__section">
            <div class="sidebar__section-header">
              <span class="sidebar__section-title">Recent searches</span>
              <span class="sidebar__section-count">{props.history().length}</span>
            </div>
            <ActionListbox
              options={historyOptions()}
              onSelect={(option) => props.applyTerm(option.data)}
              ariaLabel="Recent searches"
              variant="search-history"
            />
          </div>
        </Show>
        <Show when={props.query().trim().length > 0}>
          <Show when={props.mode() === "answer" && props.answer()}>
            {(answer) => (
              <div class="sidebar__section">
                <div class="sidebar__section-header">
                  <span class="sidebar__section-title">Answer</span>
                  <span class="sidebar__section-count">
                    {(answer().citations ?? []).length}
                  </span>
                </div>
                <div class="sidebar__section-body">
                  <p>{answer().answer}</p>
                </div>
                <ActionListbox
                  options={citationOptions()}
                  onSelect={(option) => props.onCitationSelect(option.data)}
                  ariaLabel="Answer citations"
                  variant="search-results"
                  emptyState={
                    <EmptyState class="sidebar__empty" message="No citations" />
                  }
                />
              </div>
            )}
          </Show>
          <div class="sidebar__section">
            <div class="sidebar__section-header">
              <span class="sidebar__section-title">Results</span>
              <span class="sidebar__section-count">{props.results().length}</span>
            </div>
            <Show
              when={props.mode() !== "answer"}
              fallback={
                <EmptyState class="sidebar__empty" message="Answer mode does not list raw hits" />
              }
            >
              <ActionListbox
                options={resultOptions()}
                onSelect={(option) => props.onResultSelect(option.data)}
                ariaLabel="Search results"
                variant="search-results"
                itemLabelClass="search-result-card"
                itemDescriptionClass="search-result-card__breadcrumb"
                renderLabel={(option) => (
                  <div class="search-result-card__content">
                    <Show when={option.data.title?.trim()}>
                      <div class="search-result-card__title">{option.data.title?.trim()}</div>
                    </Show>
                    <div class="search-result-card__snippet">
                      {props.renderHighlight(option.data.text || "Untitled")}
                    </div>
                  </div>
                )}
                renderDescription={(option) => (
                  <span>{option.data.breadcrumb?.trim() || option.description}</span>
                )}
                emptyState={
                  <EmptyState class="sidebar__empty" message="No matches found" />
                }
              />
            </Show>
          </div>
        </Show>
        {props.children}
      </div>
    </>
  );
};
