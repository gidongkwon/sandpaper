import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor
} from "solid-js";
import { EditorPane } from "../editor/editor-pane";
import type {
  RefineDestinationRecommendation,
  RefineDestinationSuggestion,
  RefineQueueItem,
  RefineQueueSummary,
  RefineTab,
  RefineTemplate,
  RefineThread
} from "../../entities/refine/model/refine-types";
import type { PageSummary } from "../../entities/page/model/page-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { AlertDialog } from "../../shared/ui/alert-dialog";
import { SegmentedTabs } from "../../shared/ui/segmented-tabs";
import { Button } from "../../shared/ui/button";
import { ArrowRight16Icon } from "../../shared/ui/icons";
import { RefineArchiveList } from "./refine-archive-list";
import { RefineQueueDeck } from "./refine-queue-deck";
import { RefineSessionBar } from "./refine-session-bar";

type PropsOf<T> = T extends (props: infer P) => unknown ? P : never;

type RefineWorkbenchProps = {
  summary: Accessor<RefineQueueSummary>;
  items: Accessor<RefineQueueItem[]>;
  busy: Accessor<boolean>;
  message: Accessor<string | null>;
  templates: RefineTemplate[];
  selectedTemplate: Accessor<string>;
  setSelectedTemplate: (value: string) => void;
  formatReviewDate: (value: number | null) => string;
  onAction: (item: RefineQueueItem, action: "snooze" | "later" | "done") => void;
  onCreateTemplate: () => void;
  isTauri: () => boolean;
  activeId: Accessor<string | null>;
  onAddCurrent: (id: string) => void | Promise<void>;
  threads: Accessor<RefineThread[]>;
  activeThread: Accessor<RefineThread | null>;
  archivedThreads: Accessor<RefineThread[]>;
  selectedArchivedThread: Accessor<RefineThread | null>;
  activeTab: Accessor<RefineTab>;
  setActiveTab: (tab: RefineTab) => void;
  selectedThreadId: Accessor<string | null>;
  onSelectThread: (id: string) => void;
  onOpenArchivedThread: (id: string) => void | Promise<void>;
  destinationQuery: Accessor<string>;
  setDestinationQuery: (value: string) => void;
  destinationMatches: Accessor<PageSummary[]>;
  destinationHasExactMatch: Accessor<boolean>;
  destinationSuggestions: Accessor<RefineDestinationSuggestion[]>;
  destinationTitle: Accessor<string | null>;
  destinationSelected: Accessor<boolean>;
  destinationPageUid: Accessor<string | null>;
  destinationRecommendations: Accessor<RefineDestinationRecommendation[]>;
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

export const RefineWorkbench = (props: RefineWorkbenchProps) => {
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<null | (() => void | Promise<void>)>(
    null
  );
  const [hasExplicitDestinationChoice, setHasExplicitDestinationChoice] =
    createSignal(false);
  const [destinationPanelMode, setDestinationPanelMode] = createSignal<
    "editor" | "select"
  >("select");
  const [leftPanePercent, setLeftPanePercent] = createSignal(50);
  const [isResizing, setIsResizing] = createSignal(false);
  let layoutRef: HTMLDivElement | undefined;
  const remainingDeckCount = createMemo(() =>
    Math.max(props.threads().length - Math.min(props.threads().length, 3), 0)
  );
  const defaultPanePercent = 50;
  const resizeStep = 5;
  const minPaneWidth = 320;

  const clampPanePercent = (nextPercent: number) => {
    const width = layoutRef?.getBoundingClientRect().width ?? 0;
    if (width <= 0) {
      return Math.min(70, Math.max(30, nextPercent));
    }
    const minPercent = Math.min(45, Math.max(20, (minPaneWidth / width) * 100));
    return Math.min(100 - minPercent, Math.max(minPercent, nextPercent));
  };

  const updatePanePercent = (nextPercent: number) => {
    setLeftPanePercent(clampPanePercent(nextPercent));
  };

  const resetPanePercent = () => {
    setLeftPanePercent(defaultPanePercent);
  };

  const updatePaneFromClientX = (clientX: number) => {
    const rect = layoutRef?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    updatePanePercent(((clientX - rect.left) / rect.width) * 100);
  };

  const stopResizing = () => {
    setIsResizing(false);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  };

  const handlePointerMove = (event: PointerEvent) => {
    updatePaneFromClientX(event.clientX);
  };

  const handlePointerUp = () => {
    stopResizing();
  };

  const startResizing = (event: PointerEvent) => {
    event.preventDefault();
    updatePaneFromClientX(event.clientX);
    setIsResizing(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleDividerKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updatePanePercent(leftPanePercent() - resizeStep);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      updatePanePercent(leftPanePercent() + resizeStep);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      resetPanePercent();
    }
  };

  onCleanup(() => {
    stopResizing();
  });

  createEffect((previousSignature?: string) => {
    const nextSignature = [
      props.activeTab(),
      props.selectedThreadId(),
      props.destinationPageUid(),
      props.destinationSelected(),
      props.destinationIsHardSelected(),
      props.invalidated()
    ].join("|");
    if (nextSignature === previousSignature) return previousSignature;
    if (props.activeTab() !== "to-refine") {
      setHasExplicitDestinationChoice(false);
      setDestinationPanelMode("editor");
      return nextSignature;
    }
    if (!props.destinationSelected() || props.invalidated()) {
      setHasExplicitDestinationChoice(false);
      setDestinationPanelMode("select");
      return nextSignature;
    }
    if (hasExplicitDestinationChoice()) {
      setDestinationPanelMode("editor");
      return nextSignature;
    }
    if (!props.destinationIsHardSelected()) {
      setDestinationPanelMode("select");
      return nextSignature;
    }
    setDestinationPanelMode("editor");
    return nextSignature;
  }, "");

  const canToggleDestinationSelection = createMemo(
    () =>
      props.activeTab() === "to-refine" &&
      !props.invalidated() &&
      props.destinationSelected()
  );

  const toggleDestinationPanelMode = () => {
    if (!canToggleDestinationSelection()) return;
    setDestinationPanelMode((current) => (current === "select" ? "editor" : "select"));
  };
  const showEditorPane = createMemo(
    () => props.activeTab() !== "to-refine" || destinationPanelMode() === "editor"
  );

  const formatCapturedRange = (thread: RefineThread) => {
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
            <div>No capture threads to refine.</div>
            <div>Capture a thread first, then refine it here.</div>
          </EmptyState>
        }
      >
        <div
          ref={(el) => {
            layoutRef = el;
          }}
          class="review-workbench__layout"
          data-layout="split"
          data-resizing={isResizing() ? "true" : "false"}
          style={{ "--review-left-pane": `${leftPanePercent()}%` }}
        >
          <section
            class="review-workbench__surface"
            aria-label="Refine surface"
            data-review-tab={props.activeTab()}
          >
            <div
              class="review-workbench__surface-body"
              data-review-tab={props.activeTab()}
              data-transition-slot="capture"
              style={{ "view-transition-name": "mode-pane-capture" }}
            >
              <Show
                when={props.activeTab() === "to-refine"}
                fallback={
                  <RefineArchiveList
                    threads={props.archivedThreads()}
                    selectedThreadId={props.selectedArchivedThread()?.id ?? null}
                    onOpenThread={(id) => void props.onOpenArchivedThread(id)}
                    formatCapturedRange={formatCapturedRange}
                    formatReviewDate={(value) => props.formatReviewDate(value ?? null)}
                  />
                }
              >
                <RefineQueueDeck
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
                  { value: "to-refine", label: "To Refine" },
                  { value: "archived", label: "Archived" }
                ]}
                aria-label="Refine tabs"
                class="review-workbench__tabs"
                triggerClass="review-workbench__tab"
              />
              <div class="review-workbench__footer-meta">
                <Show when={props.activeTab() === "to-refine" && remainingDeckCount() > 0}>
                  <span class="review-queue-deck__more">{`${remainingDeckCount()} more`}</span>
                </Show>
              </div>
            </div>
          </section>

          <div
            class="review-workbench__divider"
            role="separator"
            aria-label="Resize refine panes"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(leftPanePercent())}
            tabIndex={0}
            onPointerDown={(event) => startResizing(event)}
            onKeyDown={(event) => handleDividerKeyDown(event)}
            onDblClick={resetPanePercent}
          >
            <span class="review-workbench__divider-grip" aria-hidden="true" />
          </div>

          <section
            class="review-workbench__editor"
            aria-label="Destination note"
            data-transition-slot="editor"
            style={{ "view-transition-name": "mode-pane-editor" }}
          >
            <div class="review-workbench__editor-card">
              <RefineSessionBar
                activeTab={props.activeTab}
                panelMode={destinationPanelMode}
                destinationSelected={props.destinationSelected}
                destinationTitle={props.destinationTitle}
                destinationPageUid={props.destinationPageUid}
                destinationRecommendations={props.destinationRecommendations}
                destinationIsHardSelected={props.destinationIsHardSelected}
                destinationQuery={props.destinationQuery}
                setDestinationQuery={props.setDestinationQuery}
                destinationMatches={props.destinationMatches}
                destinationHasExactMatch={props.destinationHasExactMatch}
                destinationSuggestions={props.destinationSuggestions}
                invalidated={props.invalidated}
                onOpenDestination={async (pageUid) => {
                  await handleOpenDestination(pageUid);
                  setHasExplicitDestinationChoice(true);
                  setDestinationPanelMode("editor");
                }}
                onCreateDestination={async () => {
                  await handleCreateDestination();
                  setHasExplicitDestinationChoice(true);
                  setDestinationPanelMode("editor");
                }}
                archivedAt={() => props.selectedArchivedThread()?.archived_at ?? null}
                formatReviewDate={(value) => props.formatReviewDate(value ?? null)}
              />
              <Show when={showEditorPane()}>
                <EditorPane {...props.editor} />
              </Show>
            </div>
            <Show when={props.activeTab() === "to-refine"}>
              <div class="review-workbench__action-row">
                <Show when={canToggleDestinationSelection()}>
                  <Button
                    variant="surface"
                    size="md"
                    class="review__button review__button--secondary"
                    onClick={toggleDestinationPanelMode}
                  >
                    {destinationPanelMode() === "select"
                      ? "Cancel Change"
                      : "Change Destination"}
                  </Button>
                </Show>
                <Button
                  variant="primary"
                  size="md"
                  class="review__button review__button--primary review__button--complete"
                  disabled={!props.canCompleteReview()}
                  onClick={() => props.onCompleteReview()}
                >
                  <ArrowRight16Icon width={16} height={16} />
                  <span>Complete Refinement</span>
                </Button>
              </div>
            </Show>
          </section>
        </div>
      </Show>

      <AlertDialog
        open={confirmOpen}
        title="Discard current draft?"
        description="This refinement already changed the destination note. Continue writing to keep the draft, or discard it before switching."
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
