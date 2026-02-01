import { For, Show, type Accessor, type Setter } from "solid-js";
import type {
  ReviewQueueItem,
  ReviewQueueSummary,
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
};

export const ReviewPane = (props: ReviewPaneProps) => (
  <div class="review">
    <div class="review__header">
      <div>
        <div class="review__eyebrow">Review mode</div>
        <h2>Daily queue</h2>
        <p>Collect highlights, revisit key blocks, and clear the queue.</p>
      </div>
      <div class="review__summary">
        <div class="review__stat">
          <span>Due now</span>
          <strong>{props.summary().due_count}</strong>
        </div>
        <div class="review__stat">
          <span>Next due</span>
          <strong>{props.formatReviewDate(props.summary().next_due_at)}</strong>
        </div>
      </div>
    </div>
    <div class="review__deck">
      <Show
        when={props.items().length > 0}
        fallback={
          <EmptyState class="review__empty">
            <div>Nothing due yet.</div>
            <div>Tag blocks for review from the editor.</div>
          </EmptyState>
        }
      >
        <For each={props.items()}>
          {(item) => (
            <article class="review-card">
              <div class="review-card__meta">
                <span>{item.page_uid}</span>
                <span>Due {props.formatReviewDate(item.due_at)}</span>
              </div>
              <div class="review-card__text">{item.text || "Untitled"}</div>
              <div class="review-card__actions">
                <button
                  class="review-card__button"
                  disabled={props.busy()}
                  onClick={() => props.onAction(item, "snooze")}
                >
                  Snooze
                </button>
                <button
                  class="review-card__button"
                  disabled={props.busy()}
                  onClick={() => props.onAction(item, "later")}
                >
                  Schedule
                </button>
                <button
                  class="review-card__button is-primary"
                  disabled={props.busy()}
                  onClick={() => props.onAction(item, "done")}
                >
                  Done
                </button>
              </div>
            </article>
          )}
        </For>
      </Show>
    </div>
    <Show when={props.message()}>
      {(message) => <div class="review__message">{message()}</div>}
    </Show>
    <div class="review__templates">
      <div class="review__template-header">
        <div>
          <div class="review__eyebrow">Templates</div>
          <div class="review__subtitle">Seed a daily review page</div>
        </div>
        <button
          class="review__button is-secondary"
          disabled={props.busy() || !props.isTauri()}
          onClick={() => props.onCreateTemplate()}
        >
          Create template
        </button>
      </div>
      <div class="review__template-grid">
        <For each={props.templates}>
          {(template) => (
            <button
              class={`review-template ${
                props.selectedTemplate() === template.id ? "is-active" : ""
              }`}
              onClick={() => props.setSelectedTemplate(template.id)}
            >
              <div class="review-template__title">{template.title}</div>
              <div class="review-template__desc">{template.description}</div>
            </button>
          )}
        </For>
      </div>
    </div>
    <div class="review__actions">
      <button
        class="review__button"
        disabled={!props.activeId() || !props.isTauri()}
        onClick={() => {
          const id = props.activeId();
          if (id) void props.onAddCurrent(id);
        }}
      >
        Add current block to review queue
      </button>
      <Show when={!props.isTauri()}>
        <span class="review__hint">Desktop app required.</span>
      </Show>
    </div>
  </div>
);
