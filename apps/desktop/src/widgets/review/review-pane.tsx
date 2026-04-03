import { For, Show, type Accessor, type Setter } from "solid-js";
import type {
  ReviewQueueItem,
  ReviewQueueSummary,
  ReviewThread,
  ReviewTemplate
} from "../../entities/review/model/review-types";
import { EmptyState } from "../../shared/ui/empty-state";

type ReviewPaneProps = {
  summary: Accessor<ReviewQueueSummary>;
  items: Accessor<ReviewQueueItem[]>;
  busy: Accessor<boolean>;
  message: Accessor<string | null>;
  templates: ReviewTemplate[];
  selectedTemplate: Accessor<string>;
  setSelectedTemplate: Setter<string>;
  formatReviewDate: (value: number | null) => string;
  onAction: (item: ReviewQueueItem, action: "snooze" | "later" | "done") => void;
  onCreateTemplate: () => void;
  isTauri: () => boolean;
  activeId: Accessor<string | null>;
  onAddCurrent: (id: string) => void | Promise<void>;
  threads: Accessor<ReviewThread[]>;
  selectedThreadId: Accessor<string | null>;
  onSelectThread: (id: string) => void;
};

export const ReviewPane = (props: ReviewPaneProps) => {
  const selectedThread = () =>
    props.threads().find((thread) => thread.id === props.selectedThreadId()) ?? null;

  return (
    <div class="review">
      <div class="review__header">
        <div>
          <div class="review__eyebrow">Review mode</div>
          <h2>Review workbench</h2>
          <p>Refine temporary capture threads into permanent notes.</p>
        </div>
        <div class="review__summary">
          <div class="review__stat">
            <span>Threads</span>
            <strong>{props.threads().length}</strong>
          </div>
          <div class="review__stat">
            <span>Current</span>
            <strong>{selectedThread()?.root_text ?? "—"}</strong>
          </div>
        </div>
      </div>

      <Show
        when={props.threads().length > 0}
        fallback={
          <EmptyState class="review__empty">
            <div>No capture threads to review.</div>
            <div>Capture a thread first, then refine it here.</div>
          </EmptyState>
        }
      >
        <div class="review__workspace">
          <nav class="review__queue" aria-label="Review queue">
            <div class="review__queue-header">
              <div class="review__eyebrow">Queue</div>
              <div class="review__subtitle">Oldest threads first</div>
            </div>
            <div class="review__queue-list">
              <For each={props.threads()}>
                {(thread) => (
                  <button
                    class={`review-thread-item ${
                      props.selectedThreadId() === thread.id ? "is-active" : ""
                    }`}
                    onClick={() => props.onSelectThread(thread.id)}
                  >
                    <div class="review-thread-item__title">{thread.root_text}</div>
                    <div class="review-thread-item__meta">
                      {thread.entries.length} entries
                    </div>
                  </button>
                )}
              </For>
            </div>
          </nav>

          <section class="review__thread-panel" aria-labelledby="review-thread-heading">
            <h3 id="review-thread-heading">Capture thread</h3>
            <Show when={selectedThread()}>
              {(thread) => (
                <div class="review-thread">
                  <For each={thread().entries}>
                    {(entry) => (
                      <article
                        class={`review-thread__entry ${
                          entry.is_root ? "is-root" : "is-reply"
                        }`}
                      >
                        <div class="review-thread__label">
                          {entry.is_root ? "Root" : "Reply"}
                        </div>
                        <div class="review-thread__text">{entry.text}</div>
                      </article>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </section>

          <section class="review__editor-panel" aria-labelledby="review-editor-heading">
            <h3 id="review-editor-heading">Destination note</h3>
            <p>Destination selection and editing land in the next slice.</p>
          </section>
        </div>
      </Show>

      <Show when={props.message()}>
        {(message) => <div class="review__message">{message()}</div>}
      </Show>
    </div>
  );
};
