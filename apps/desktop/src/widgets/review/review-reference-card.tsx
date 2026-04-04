import { For, Show } from "solid-js";
import type { ReviewThread } from "../../entities/review/model/review-types";
import { Button } from "../../shared/ui/button";

type ReviewReferenceCardProps = {
  thread: ReviewThread;
  capturedLabel: string;
  clickable?: boolean;
  compact?: boolean;
  active?: boolean;
  peekLevel?: 0 | 1 | 2;
  archivedLabel?: string | null;
  destinationLabel?: string | null;
  onSelect?: () => void;
};

export const ReviewReferenceCard = (props: ReviewReferenceCardProps) => {
  const content = (
    <>
      <div class="review-reference-card__meta">
        <span>{props.capturedLabel}</span>
        <Show when={props.archivedLabel}>
          {(archivedLabel) => <span>{archivedLabel()}</span>}
        </Show>
      </div>
      <div class="review-reference-card__entries">
        <For each={props.thread.entries}>
          {(entry) => <p class="review-reference-card__entry">{entry.text}</p>}
        </For>
      </div>
      <Show when={props.destinationLabel}>
        {(destinationLabel) => (
          <div class="review-reference-card__destination">{destinationLabel()}</div>
        )}
      </Show>
    </>
  );

  const className = () =>
    [
      "review-reference-card",
      props.compact ? "is-compact" : "",
      props.active ? "is-active" : "",
      props.peekLevel ? `is-peek-${props.peekLevel}` : "",
      props.clickable ? "is-clickable" : ""
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <Show
      when={props.clickable}
      fallback={<article class={className()}>{content}</article>}
    >
      <Button
        class={className()}
        variant="unstyled"
        onClick={() => props.onSelect?.()}
      >
        {content}
      </Button>
    </Show>
  );
};
