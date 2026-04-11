import { For, Show } from "solid-js";
import type { RefineThread } from "../../entities/refine/model/refine-types";
import { RefineReferenceCard } from "./refine-reference-card";

type RefineArchiveListProps = {
  threads: RefineThread[];
  selectedThreadId: string | null;
  onOpenThread: (id: string) => void;
  formatCapturedRange: (thread: RefineThread) => string;
  formatReviewDate: (value: number | null | undefined) => string;
};

export const RefineArchiveList = (props: RefineArchiveListProps) => (
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
            <RefineReferenceCard
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
