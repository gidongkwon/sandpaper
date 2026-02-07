import { For, Show, type Accessor, type JSX, type Setter } from "solid-js";
import type { SearchResult } from "../../entities/search/model/search-types";
import { Chip } from "../../shared/ui/chip";
import { EmptyState } from "../../shared/ui/empty-state";
import { Search16Icon } from "../../shared/ui/icons";

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
          <Search16Icon class="sidebar__search-icon" width="14" height="14" />
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
          <Chip
            active={props.filter() === "all"}
            onClick={() => props.setFilter("all")}
          >
            All
          </Chip>
          <Chip
            active={props.filter() === "links"}
            onClick={() => props.setFilter("links")}
          >
            Links
          </Chip>
          <Chip
            active={props.filter() === "tasks"}
            onClick={() => props.setFilter("tasks")}
          >
            Tasks
          </Chip>
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
                fallback={
                  <EmptyState class="sidebar__empty" message="No matches found" />
                }
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
