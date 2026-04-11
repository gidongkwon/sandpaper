import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Accessor,
  useTransition
} from "solid-js";
import type { PageSummary } from "../../entities/page/model/page-types";
import type {
  RefineDestinationRecommendation,
  RefineDestinationSuggestion,
  RefineTab
} from "../../entities/refine/model/refine-types";
import { Search16Icon } from "../../shared/ui/icons";
import { TextField } from "../../shared/ui/text-field";

type RefineSessionBarProps = {
  activeTab: Accessor<RefineTab>;
  panelMode: Accessor<"editor" | "select">;
  destinationSelected: Accessor<boolean>;
  destinationTitle: Accessor<string | null>;
  destinationPageUid: Accessor<string | null>;
  destinationRecommendations: Accessor<RefineDestinationRecommendation[]>;
  destinationIsHardSelected: Accessor<boolean>;
  destinationQuery: Accessor<string>;
  setDestinationQuery: (value: string) => void;
  destinationMatches: Accessor<PageSummary[]>;
  destinationHasExactMatch: Accessor<boolean>;
  destinationSuggestions: Accessor<RefineDestinationSuggestion[]>;
  invalidated: Accessor<boolean>;
  onOpenDestination: (pageUid: string) => void | Promise<void>;
  onCreateDestination: () => void | Promise<void>;
  archivedAt: Accessor<number | null>;
  formatReviewDate: (value: number | null) => string;
};

export const RefineSessionBar = (props: RefineSessionBarProps) => {
  type DestinationListItem =
    | {
        kind: "page";
        key: string;
        pageUid: string;
        title: string;
        reason: string;
        snippet: string | null;
        providerLabel: string;
      }
    | {
        kind: "create";
        key: string;
        title: string;
        reason: string;
        providerLabel: string;
      };

  const [localDestinationQuery, setLocalDestinationQuery] = createSignal(
    props.destinationQuery()
  );
  const [isDestinationTransitionPending, startDestinationTransition] =
    useTransition();

  createEffect(() => {
    const nextQuery = props.destinationQuery();
    if (nextQuery !== localDestinationQuery()) {
      setLocalDestinationQuery(nextQuery);
    }
  });

  const isRecommended = createMemo(() => {
    if (props.activeTab() !== "to-refine") return false;
    if (props.destinationIsHardSelected()) return false;
    const destinationPageUid = props.destinationPageUid();
    if (!destinationPageUid) return false;
    return props
      .destinationRecommendations()
      .some((item) => item.page_uid === destinationPageUid);
  });

  const destinationListItems = createMemo<DestinationListItem[]>(() => {
    const query = props.destinationQuery().trim();
    if (query.length > 0) {
      const pageItems: DestinationListItem[] = props.destinationMatches().map((page) => ({
        kind: "page",
        key: `page:${page.uid}`,
        pageUid: page.uid,
        title: page.title,
        reason: "Open existing page",
        snippet: null,
        providerLabel: "Existing"
      }));
      if (!props.destinationHasExactMatch()) {
        pageItems.unshift({
          kind: "create",
          key: `create:${query}`,
          title: `Create "${query}"`,
          reason: "Create and open a new destination page",
          providerLabel: "New"
        });
      }
      return pageItems;
    }
    return props.destinationSuggestions().map((suggestion) => ({
      kind: "page",
      key: `suggestion:${suggestion.page_uid}`,
      pageUid: suggestion.page_uid,
      title: suggestion.title,
      reason: suggestion.reason,
      snippet: suggestion.snippet,
      providerLabel: suggestion.provider === "rag" ? "Rag Match" : "Suggested"
    }));
  });

  const suggestionHeading = createMemo(() =>
    props.destinationQuery().trim().length > 0
      ? "Matching pages"
      : "Suggested destinations"
  );

  return (
    <header class="review-session-bar" data-mode={props.panelMode()}>
      <Show
        when={props.activeTab() === "to-refine" && props.panelMode() === "select"}
        fallback={
          <div class="review-session-bar__panel review-session-bar__panel--editor">
            <div class="review-session-bar__meta-row">
              <Show when={isRecommended()}>
                <span class="review-session-bar__badge">Recommended</span>
              </Show>
              <Show when={props.destinationIsHardSelected() && props.activeTab() === "to-refine"}>
                <span class="review-session-bar__hint">Locked for this refinement</span>
              </Show>
              <Show when={props.activeTab() === "archived" && props.archivedAt() !== null}>
                <span class="review-session-bar__hint">
                  {`Archived ${props.formatReviewDate(props.archivedAt())}`}
                </span>
              </Show>
              <Show when={props.invalidated()}>
                <span class="review-session-bar__warning">Pick a destination again</span>
              </Show>
            </div>
          </div>
        }
      >
        <div class="review-session-bar__panel review-session-bar__panel--select">
          <div class="review-session-bar__meta-row">
            <Show when={isRecommended()}>
              <span class="review-session-bar__badge">Recommended</span>
            </Show>
            <Show when={props.invalidated()}>
              <span class="review-session-bar__warning">Pick a destination again</span>
            </Show>
          </div>

          <div class="review-session-bar__search">
            <span class="review-session-bar__search-icon" aria-hidden="true">
              <Search16Icon width="14" height="14" />
            </span>
            <TextField
              aria-label="Destination page"
              type="text"
              value={localDestinationQuery()}
              onInput={(event) => {
                const nextQuery = event.currentTarget.value;
                setLocalDestinationQuery(nextQuery);
                startDestinationTransition(() => {
                  props.setDestinationQuery(nextQuery);
                });
              }}
              size="md"
              font="body"
              class="review-session-bar__search-input"
              data-pending={isDestinationTransitionPending() ? "" : undefined}
              autocomplete="off"
              spellcheck={false}
              autocapitalize="off"
              autocorrect="off"
              placeholder="Search or create a page..."
            />
          </div>

          <div
            class="review-session-bar__suggestions"
            data-pending={isDestinationTransitionPending() ? "" : undefined}
          >
            <div class="review-session-bar__suggestions-header">
              <span class="review-session-bar__suggestions-title">
                {suggestionHeading()}
              </span>
            </div>
            <Show
              when={destinationListItems().length > 0}
              fallback={
                <div class="review-session-bar__suggestions-empty">
                  Search for a page above or create a new destination.
                </div>
              }
            >
              <div
                class="review-session-bar__suggestion-list"
                role="listbox"
                aria-label="Destination page options"
              >
                <For each={destinationListItems()}>
                  {(item) => (
                    <button
                      type="button"
                      role="option"
                      class="review-session-bar__suggestion"
                      aria-label={
                        item.kind === "create"
                          ? item.title
                          : props.destinationQuery().trim().length > 0
                            ? `Open ${item.title}`
                            : item.title
                      }
                      onClick={() => {
                        if (item.kind === "create") {
                          void props.onCreateDestination();
                          return;
                        }
                        void props.onOpenDestination(item.pageUid);
                      }}
                    >
                      <div class="review-session-bar__suggestion-row">
                        <span class="review-session-bar__suggestion-title">
                          {item.title}
                        </span>
                        <span class="review-session-bar__suggestion-provider">
                          {item.providerLabel}
                        </span>
                      </div>
                      <div class="review-session-bar__suggestion-reason">
                        {item.reason}
                      </div>
                      <Show when={item.kind === "page" && item.snippet}>
                        <div class="review-session-bar__suggestion-snippet">
                          {item.kind === "page" ? item.snippet : null}
                        </div>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </header>
  );
};
