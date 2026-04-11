import { For, Show } from "solid-js";
import type { ReviewThread } from "../../entities/review/model/review-types";
import { ReviewReferenceCard } from "./review-reference-card";

type ReviewArchiveListProps = {
  threads: ReviewThread[];
  selectedThreadId: string | null;
  onOpenThread: (id: string) => void;
  formatCapturedRange: (thread: ReviewThread) => string;
  formatReviewDate: (value: number | null | undefined) => string;
};

export const ReviewArchiveList = (props: ReviewArchiveListProps) => (
  <Show
    when={props.threads.length > 0}
    fallback={<div class="review-archive-list__empty">Archived items will appear here.</div>}
  >
    <nav class="review-archive-list" aria-label="Archived refine queue">
      <For each={props.threads}>
        {(thread) => (
          <div
            class={`review-archive-list__item ${
              props.selectedThreadId === thread.id ? "is-selected" : ""
            }`}
          >
            <ReviewReferenceCard
              thread={thread}
              compact
              clickable
              capturedLabel={props.formatCapturedRange(thread)}
              archivedLabel={
                typeof thread.archived_at === "number"
                  ? `Archived ${props.formatReviewDate(thread.archived_at)}`
                  : null
              }
              destinationLabel={thread.destination_title ?? null}
              onSelect={() => props.onOpenThread(thread.id)}
            />
          </div>
        )}
      </For>
    </nav>
  </Show>
);
