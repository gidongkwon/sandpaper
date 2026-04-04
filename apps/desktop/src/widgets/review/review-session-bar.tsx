import { For, Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type { PageSummary } from "../../entities/page/model/page-types";
import type {
  DestinationRecommendation,
  ReviewTab
} from "../../entities/review/model/review-types";

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
  const hasMetaContent = createMemo(
    () =>
      Boolean(props.destinationTitle()) ||
      isRecommended() ||
      (props.activeTab() === "archived" && props.archivedAt() !== null) ||
      props.invalidated()
  );

  return (
    <header class="review-session-bar" data-has-meta={hasMetaContent()}>
      <div class="review-session-bar__meta" data-has-meta={hasMetaContent()}>
        <div class="review-session-bar__title-row" data-has-title={Boolean(props.destinationTitle())}>
          <Show when={props.destinationTitle()}>
            {(title) => <strong>{title()}</strong>}
          </Show>
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
            <div class="review-session-bar__search">
              <input
                type="text"
                placeholder="Search or create a page..."
                value={props.destinationQuery()}
                onInput={(event) => props.setDestinationQuery(event.currentTarget.value)}
              />
              <Show when={props.destinationQuery().trim().length > 0}>
                <div class="review-session-bar__results">
                  <For each={props.destinationMatches()}>
                    {(page) => (
                      <button
                        class="review-session-bar__result"
                        type="button"
                        onClick={() => void props.onOpenDestination(page.uid)}
                      >
                        {`Open ${page.title}`}
                      </button>
                    )}
                  </For>
                  <Show when={!props.destinationHasExactMatch()}>
                    <button
                      class="review-session-bar__result is-primary"
                      type="button"
                      onClick={() => void props.onCreateDestination()}
                    >
                      {`Create "${props.destinationQuery().trim()}"`}
                    </button>
                  </Show>
                </div>
              </Show>
              <Show when={props.destinationQuery().trim().length === 0 && visibleRecommendations().length > 0}>
                <div class="review-session-bar__results">
                  <For each={visibleRecommendations()}>
                    {(recommendation) => (
                      <button
                        class={`review-session-bar__result ${
                          recommendation.page_uid === props.destinationPageUid()
                            ? "is-active"
                            : ""
                        }`}
                        type="button"
                        onClick={() => void props.onOpenDestination(recommendation.page_uid)}
                      >
                        <span>{recommendation.title}</span>
                        <small>{recommendation.reasons[0] ?? "Recommended"}</small>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
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
