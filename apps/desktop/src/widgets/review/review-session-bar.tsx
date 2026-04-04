import { Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type { PageSummary } from "../../entities/page/model/page-types";
import type {
  DestinationRecommendation,
  ReviewTab
} from "../../entities/review/model/review-types";
import { SearchableCombobox, type SearchableComboboxOption } from "../../shared/ui/searchable-combobox";

type ReviewSessionBarProps = {
  activeTab: Accessor<ReviewTab>;
  destinationSelected: Accessor<boolean>;
  destinationTitle: Accessor<string | null>;
  destinationPageUid: Accessor<string | null>;
  destinationRecommendations: Accessor<DestinationRecommendation[]>;
  destinationIsHardSelected: Accessor<boolean>;
  destinationQuery: Accessor<string>;
  setDestinationQuery: (value: string) => void;
  destinationMatches: Accessor<PageSummary[]>;
  destinationHasExactMatch: Accessor<boolean>;
  invalidated: Accessor<boolean>;
  onOpenDestination: (pageUid: string) => void | Promise<void>;
  onCreateDestination: () => void | Promise<void>;
  onCompleteReview: () => void;
  canCompleteReview: Accessor<boolean>;
  archivedAt: Accessor<number | null>;
  formatReviewDate: (value: number | null) => string;
};

export const ReviewSessionBar = (props: ReviewSessionBarProps) => {
  const [searchOpen, setSearchOpen] = createSignal(true);

  createEffect((wasHardSelected: boolean) => {
    if (props.activeTab() === "archived") {
      setSearchOpen(false);
      return props.destinationIsHardSelected();
    }
    if (props.invalidated()) {
      setSearchOpen(true);
      return props.destinationIsHardSelected();
    }
    if (!props.destinationIsHardSelected()) {
      setSearchOpen(true);
      return false;
    }
    if (!wasHardSelected) {
      setSearchOpen(false);
    }
    return true;
  }, false);

  const isRecommended = createMemo(() => {
    if (props.activeTab() !== "to-review") return false;
    if (props.destinationIsHardSelected()) return false;
    const destinationPageUid = props.destinationPageUid();
    if (!destinationPageUid) return false;
    return props
      .destinationRecommendations()
      .some((item) => item.page_uid === destinationPageUid);
  });

  const visibleRecommendations = createMemo(() => {
    if (props.destinationQuery().trim().length > 0) return [];
    return props.destinationRecommendations();
  });
  const handleDestinationSelect = (value: string) => {
    if (value.startsWith("open:")) {
      void props.onOpenDestination(value.slice(5));
      return;
    }
    if (value.startsWith("create:")) {
      void props.onCreateDestination();
    }
  };
  const destinationOptions = createMemo<SearchableComboboxOption[]>(() => {
    const query = props.destinationQuery().trim();
    if (query.length > 0) {
      const pageOptions = props.destinationMatches().map((page) => ({
        value: `open:${page.uid}`,
        label: `Open ${page.title}`,
        inputLabel: page.title,
        description: null
      }));
      if (!props.destinationHasExactMatch()) {
        pageOptions.push({
          value: `create:${query}`,
          label: `Create "${query}"`,
          inputLabel: query,
          description: null
        });
      }
      return pageOptions;
    }
    return visibleRecommendations().map((recommendation) => ({
      value: `open:${recommendation.page_uid}`,
      label: recommendation.title,
      inputLabel: recommendation.title,
      description: recommendation.reasons[0] ?? "Recommended"
    }));
  });
  const hasMetaContent = createMemo(
    () =>
      isRecommended() ||
      (props.activeTab() === "archived" && props.archivedAt() !== null) ||
      props.invalidated()
  );

  return (
    <header class="review-session-bar" data-has-meta={hasMetaContent()}>
      <div class="review-session-bar__meta" data-has-meta={hasMetaContent()}>
        <div class="review-session-bar__title-row" data-has-title="false">
          <Show when={isRecommended()}>
            <span class="review-session-bar__badge">Recommended</span>
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

      <Show when={props.activeTab() === "to-review"}>
        <div class="review-session-bar__actions">
          <Show
            when={!props.destinationIsHardSelected() || searchOpen()}
            fallback={
              <button
                class="review__button is-secondary"
                type="button"
                onClick={() => setSearchOpen(true)}
              >
                Change destination
              </button>
            }
          >
            <SearchableCombobox
              options={destinationOptions()}
              onChange={(value) => handleDestinationSelect(value)}
              onOptionSelect={(option) => handleDestinationSelect(option.value)}
              queryValue={props.destinationQuery()}
              onQueryChange={props.setDestinationQuery}
              shouldFilter={false}
              ariaLabel="Destination page"
              listboxLabel="Destination page options"
              placeholder="Search or create a page..."
              noResultsLabel="No matches"
              class="review-session-bar__search"
              controlClass="review-session-bar__search-control"
              inputClass="review-session-bar__search-input"
              contentClass="review-session-bar__results"
              listboxClass="review-session-bar__results-listbox"
              itemClass={(option) =>
                `review-session-bar__result ${
                  option.value.startsWith("create:") ? "is-primary" : ""
                }`.trim()
              }
              itemLabelClass="review-session-bar__result-label"
              itemDescriptionClass="review-session-bar__result-description"
            />
          </Show>
          <button
            class="review__button is-primary"
            type="button"
            disabled={!props.canCompleteReview()}
            onClick={() => props.onCompleteReview()}
          >
            Complete review
          </button>
        </div>
      </Show>
    </header>
  );
};
