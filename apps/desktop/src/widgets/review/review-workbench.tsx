import { Show, type Accessor } from "solid-js";
import { EditorPane } from "../editor/editor-pane";
import type {
  DestinationRecommendation,
  ReviewQueueItem,
  ReviewQueueSummary,
  ReviewTab,
  ReviewTemplate,
  ReviewThread
} from "../../entities/review/model/review-types";
import type { PageSummary } from "../../entities/page/model/page-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { ReviewArchiveList } from "./review-archive-list";
import { ReviewQueueDeck } from "./review-queue-deck";
import { ReviewSessionBar } from "./review-session-bar";

type PropsOf<T> = T extends (props: infer P) => unknown ? P : never;

type ReviewWorkbenchProps = {
  summary: Accessor<ReviewQueueSummary>;
  items: Accessor<ReviewQueueItem[]>;
  busy: Accessor<boolean>;
  message: Accessor<string | null>;
  templates: ReviewTemplate[];
  selectedTemplate: Accessor<string>;
  setSelectedTemplate: (value: string) => void;
  formatReviewDate: (value: number | null) => string;
  onAction: (item: ReviewQueueItem, action: "snooze" | "later" | "done") => void;
  onCreateTemplate: () => void;
  isTauri: () => boolean;
  activeId: Accessor<string | null>;
  onAddCurrent: (id: string) => void | Promise<void>;
  threads: Accessor<ReviewThread[]>;
  activeThread: Accessor<ReviewThread | null>;
  archivedThreads: Accessor<ReviewThread[]>;
  selectedArchivedThread: Accessor<ReviewThread | null>;
  activeTab: Accessor<ReviewTab>;
  setActiveTab: (tab: ReviewTab) => void;
  selectedThreadId: Accessor<string | null>;
  onSelectThread: (id: string) => void;
  onOpenArchivedThread: (id: string) => void | Promise<void>;
  destinationQuery: Accessor<string>;
  setDestinationQuery: (value: string) => void;
  destinationMatches: Accessor<PageSummary[]>;
  destinationHasExactMatch: Accessor<boolean>;
  destinationTitle: Accessor<string | null>;
  destinationSelected: Accessor<boolean>;
  destinationPageUid: Accessor<string | null>;
  destinationRecommendations: Accessor<DestinationRecommendation[]>;
  destinationIsHardSelected: Accessor<boolean>;
  invalidated: Accessor<boolean>;
  onOpenDestination: (pageUid: string) => void | Promise<void>;
  onCreateDestination: () => void | Promise<void>;
  onCompleteReview: () => void;
  canCompleteReview: Accessor<boolean>;
  editor: PropsOf<typeof EditorPane>;
};

export const ReviewWorkbench = (props: ReviewWorkbenchProps) => {
  const formatCapturedRange = (thread: ReviewThread) => {
    if (!thread.captured_at_start) return "Captured —";
    const start = props.formatReviewDate(thread.captured_at_start);
    if (!thread.captured_at_end || thread.captured_at_end === thread.captured_at_start) {
      return `Captured ${start}`;
    }
    return `Captured ${start} - ${props.formatReviewDate(thread.captured_at_end)}`;
  };

  return (
    <div class="review review-workbench">
      <Show
        when={props.threads().length > 0 || props.archivedThreads().length > 0}
        fallback={
          <EmptyState class="review__empty">
            <div>No capture threads to review.</div>
            <div>Capture a thread first, then refine it here.</div>
          </EmptyState>
        }
      >
        <div class="review-workbench__layout">
          <section class="review-workbench__surface" aria-label="Review surface">
            <div class="review-workbench__surface-body">
              <Show
                when={props.activeTab() === "to-review"}
                fallback={
                  <ReviewArchiveList
                    threads={props.archivedThreads()}
                    selectedThreadId={props.selectedArchivedThread()?.id ?? null}
                    onOpenThread={(id) => void props.onOpenArchivedThread(id)}
                    formatCapturedRange={formatCapturedRange}
                    formatReviewDate={(value) => props.formatReviewDate(value ?? null)}
                  />
                }
              >
                <ReviewQueueDeck
                  threads={props.threads()}
                  activeThreadId={props.selectedThreadId()}
                  onSelectThread={props.onSelectThread}
                  formatCapturedRange={formatCapturedRange}
                />
              </Show>
            </div>

            <div class="review-workbench__tabs" role="tablist" aria-label="Review tabs">
              <button
                class={`review-workbench__tab ${
                  props.activeTab() === "to-review" ? "is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={props.activeTab() === "to-review"}
                onClick={() => props.setActiveTab("to-review")}
              >
                To Review
              </button>
              <button
                class={`review-workbench__tab ${
                  props.activeTab() === "archived" ? "is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={props.activeTab() === "archived"}
                onClick={() => props.setActiveTab("archived")}
              >
                Archived
              </button>
            </div>
          </section>

          <section class="review-workbench__editor" aria-label="Destination note">
            <ReviewSessionBar
              activeTab={props.activeTab}
              destinationSelected={props.destinationSelected}
              destinationTitle={props.destinationTitle}
              destinationPageUid={props.destinationPageUid}
              destinationRecommendations={props.destinationRecommendations}
              destinationIsHardSelected={props.destinationIsHardSelected}
              destinationQuery={props.destinationQuery}
              setDestinationQuery={props.setDestinationQuery}
              destinationMatches={props.destinationMatches}
              destinationHasExactMatch={props.destinationHasExactMatch}
              invalidated={props.invalidated}
              onOpenDestination={props.onOpenDestination}
              onCreateDestination={props.onCreateDestination}
              onCompleteReview={props.onCompleteReview}
              canCompleteReview={props.canCompleteReview}
              archivedAt={() => props.selectedArchivedThread()?.archived_at ?? null}
              formatReviewDate={(value) => props.formatReviewDate(value ?? null)}
            />
            <EditorPane {...props.editor} />
          </section>
        </div>
      </Show>

      <Show when={props.message()}>
        {(message) => <div class="review__message">{message()}</div>}
      </Show>
    </div>
  );
};
