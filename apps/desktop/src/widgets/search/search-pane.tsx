import { For, Show, type Accessor, type JSX, type Setter } from "solid-js";
import type { SearchResult } from "../../entities/search/model/search-types";

type SearchPaneProps = {
  searchInputRef?: (el: HTMLInputElement) => void;
  query: Accessor<string>;
  setQuery: Setter<string>;
  filter: Accessor<"all" | "links" | "tasks" | "pinned">;
  setFilter: Setter<"all" | "links" | "tasks" | "pinned">;
  commitTerm: (value: string) => void;
  history: Accessor<string[]>;
  applyTerm: (term: string) => void;
  results: Accessor<SearchResult[]>;
  onResultSelect: (block: SearchResult) => void;
  renderHighlight: (text: string) => JSX.Element;
  children?: JSX.Element;
};

export const SearchPane = (props: SearchPaneProps) => {
  return (
    <>
      <div class="sidebar__header">
        <div class="sidebar__search">
          <svg class="sidebar__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16" y2="16" />
          </svg>
          <input
            ref={(el) => props.searchInputRef?.(el)}
            class="sidebar__input"
            type="search"
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
        <div class="sidebar__filters">
          <button
            class={`chip ${props.filter() === "all" ? "is-active" : ""}`}
            onClick={() => props.setFilter("all")}
          >
            All
          </button>
          <button
            class={`chip ${props.filter() === "links" ? "is-active" : ""}`}
            onClick={() => props.setFilter("links")}
          >
            Links
          </button>
          <button
            class={`chip ${props.filter() === "tasks" ? "is-active" : ""}`}
            onClick={() => props.setFilter("tasks")}
          >
            Tasks
          </button>
        </div>
      </div>

      <div class="sidebar__content">
        <Show when={props.history().length > 0}>
          <div class="sidebar__section">
            <div class="sidebar__section-header">
              <span class="sidebar__section-title">Recent searches</span>
              <span class="sidebar__section-count">{props.history().length}</span>
            </div>
            <div class="search-history">
              <For each={props.history()}>
                {(term) => (
                  <button
                    class="search-history__item"
                    aria-label={`Recent search ${term}`}
                    onClick={() => props.applyTerm(term)}
                  >
                    {term}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <Show when={props.query().trim().length > 0}>
          <div class="sidebar__section">
            <div class="sidebar__section-header">
              <span class="sidebar__section-title">Results</span>
              <span class="sidebar__section-count">{props.results().length}</span>
            </div>
            <div class="sidebar__results">
              <Show
                when={props.results().length > 0}
                fallback={<div class="sidebar__empty">No matches found</div>}
              >
                <For each={props.results()}>
                  {(block) => (
                    <button
                      class="result"
                      onClick={() => props.onResultSelect(block)}
                    >
                      <div class="result__text">
                        {props.renderHighlight(block.text || "Untitled")}
                      </div>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>
        {props.children}
      </div>
    </>
  );
};
