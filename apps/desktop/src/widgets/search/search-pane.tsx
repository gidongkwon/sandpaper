import { Show, createMemo, type Accessor, type JSX, type Setter } from "solid-js";
import type { SearchResult } from "../../entities/search/model/search-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { Search16Icon } from "../../shared/ui/icons";
import { ActionListbox, type ActionListboxOption } from "../../shared/ui/action-listbox";

type SearchPaneProps = {
  searchInputRef?: (el: HTMLInputElement) => void;
  query: Accessor<string>;
  setQuery: Setter<string>;
  commitTerm: (value: string) => void;
  history: Accessor<string[]>;
  applyTerm: (term: string) => void;
  results: Accessor<SearchResult[]>;
  onResultSelect: (block: SearchResult) => void;
  renderHighlight: (text: string) => JSX.Element;
  children?: JSX.Element;
};

export const SearchPane = (props: SearchPaneProps) => {
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
      data: result
    }))
  );

  return (
    <>
      <div class="sidebar__header">
        <div class="sidebar__search">
          <Search16Icon class="sidebar__search-icon" width="14" height="14" />
          <input
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
              class="search-history"
              itemClass="search-history__item"
              itemLabelClass="search-history__label"
            />
          </div>
        </Show>
        <Show when={props.query().trim().length > 0}>
          <div class="sidebar__section">
            <div class="sidebar__section-header">
              <span class="sidebar__section-title">Results</span>
              <span class="sidebar__section-count">{props.results().length}</span>
            </div>
            <ActionListbox
              options={resultOptions()}
              onSelect={(option) => props.onResultSelect(option.data)}
              ariaLabel="Search results"
              class="sidebar__results"
              itemClass="result"
              itemLabelClass="result__text"
              renderLabel={(option) => props.renderHighlight(option.data.text || "Untitled")}
              emptyState={
                <EmptyState class="sidebar__empty" message="No matches found" />
              }
            />
          </div>
        </Show>
        {props.children}
      </div>
    </>
  );
};
