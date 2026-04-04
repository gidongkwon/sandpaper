import { Show, createMemo, createSignal, type Accessor } from "solid-js";
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
import { AlertDialog } from "../../shared/ui/alert-dialog";
import { SegmentedTabs } from "../../shared/ui/segmented-tabs";
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
  hasDiscardableChanges: Accessor<boolean>;
  onOpenDestination: (pageUid: string) => void | Promise<void>;
  onCreateDestination: () => void | Promise<void>;
  onDiscardReviewChanges: () => void | Promise<void>;
  onCompleteReview: () => void;
  canCompleteReview: Accessor<boolean>;
  editor: PropsOf<typeof EditorPane>;
};

export const ReviewWorkbench = (props: ReviewWorkbenchProps) => {
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<null | (() => void | Promise<void>)>(
    null
  );
  const remainingDeckCount = createMemo(() =>
    Math.max(props.threads().length - Math.min(props.threads().length, 3), 0)
  );

  const formatCapturedRange = (thread: ReviewThread) => {
    if (!thread.captured_at_start) return "Captured —";
    const start = props.formatReviewDate(thread.captured_at_start);
    if (!thread.captured_at_end || thread.captured_at_end === thread.captured_at_start) {
      return `Captured ${start}`;
    }
    return `Captured ${start} - ${props.formatReviewDate(thread.captured_at_end)}`;
  };

  const requestTransition = (action: () => void | Promise<void>) => {
    if (!props.hasDiscardableChanges()) {
      void action();
      return;
    }
    setPendingAction(() => action);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setPendingAction(null);
  };

  const confirmDiscard = async () => {
    await props.onDiscardReviewChanges();
    await pendingAction()?.();
    closeConfirm();
  };

  const handleSelectThread = (id: string) => {
    if (id === props.selectedThreadId()) return;
    const selectThread = props.onSelectThread;
    requestTransition(() => selectThread(id));
  };

  const handleOpenDestination = (pageUid: string) => {
    if (pageUid === props.destinationPageUid()) return;
    const openDestination = props.onOpenDestination;
    requestTransition(() => openDestination(pageUid));
  };

  const handleCreateDestination = () => {
    const createDestination = props.onCreateDestination;
    requestTransition(() => createDestination());
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
        <div class="review-workbench__layout" data-layout="split">
          <section
            class="review-workbench__surface"
            aria-label="Review surface"
            data-review-tab={props.activeTab()}
          >
            <div
              class="review-workbench__surface-body"
              data-review-tab={props.activeTab()}
              data-transition-slot="capture"
              style={{ "view-transition-name": "mode-pane-capture" }}
            >
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
                  onSelectThread={handleSelectThread}
                  formatCapturedRange={formatCapturedRange}
                />
              </Show>
            </div>

            <div class="review-workbench__footer">
              <div class="review-workbench__footer-spacer" aria-hidden="true" />
              <SegmentedTabs
                value={props.activeTab()}
                onChange={props.setActiveTab}
                items={[
                  { value: "to-review", label: "To Review" },
                  { value: "archived", label: "Archived" }
                ]}
                aria-label="Review tabs"
                class="review-workbench__tabs"
                triggerClass="review-workbench__tab"
              />
              <div class="review-workbench__footer-meta">
                <Show when={props.activeTab() === "to-review" && remainingDeckCount() > 0}>
                  <span class="review-queue-deck__more">{`${remainingDeckCount()} more`}</span>
                </Show>
              </div>
            </div>
          </section>

          <section
            class="review-workbench__editor"
            aria-label="Destination note"
            data-transition-slot="editor"
            style={{ "view-transition-name": "mode-pane-editor" }}
          >
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
              onOpenDestination={handleOpenDestination}
              onCreateDestination={handleCreateDestination}
              onCompleteReview={props.onCompleteReview}
              canCompleteReview={props.canCompleteReview}
              archivedAt={() => props.selectedArchivedThread()?.archived_at ?? null}
              formatReviewDate={(value) => props.formatReviewDate(value ?? null)}
            />
            <EditorPane {...props.editor} />
          </section>
        </div>
      </Show>

      <AlertDialog
        open={confirmOpen}
        title="Discard current draft?"
        description="This review already changed the destination note. Continue writing to keep the draft, or discard it before switching."
        confirmLabel="Discard and switch"
        cancelLabel="Continue writing"
        onConfirm={() => void confirmDiscard()}
        onCancel={closeConfirm}
      />

      <Show when={props.message()}>
        {(message) => <div class="review__message">{message()}</div>}
      </Show>
    </div>
  );
};
