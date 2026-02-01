import { createSignal, type Accessor } from "solid-js";
import type { ReviewQueueItem, ReviewQueueSummary, ReviewTemplate } from "../../../entities/review/model/review-types";
import { formatReviewDate } from "./review-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type ReviewDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  activePageUid: Accessor<string>;
  resolvePageUid: (value: string) => string;
  loadReviewSummary: () => Promise<void>;
  loadReviewQueue: () => Promise<void>;
  loadPages: () => Promise<void>;
  state?: {
    reviewSummary: Accessor<ReviewQueueSummary>;
    setReviewSummary: (value: ReviewQueueSummary) => void;
    reviewItems: Accessor<ReviewQueueItem[]>;
    setReviewItems: (value: ReviewQueueItem[]) => void;
    reviewBusy: Accessor<boolean>;
    setReviewBusy: (value: boolean) => void;
    reviewMessage: Accessor<string | null>;
    setReviewMessage: (value: string | null) => void;
    selectedReviewTemplate: Accessor<string>;
    setSelectedReviewTemplate: (value: string) => void;
  };
};

const reviewTemplates: ReviewTemplate[] = [
  {
    id: "daily-brief",
    title: "Daily Brief",
    description: "Summaries, loose threads, and next steps."
  },
  {
    id: "deep-work",
    title: "Deep Work",
    description: "Focus recap and momentum check."
  },
  {
    id: "connections",
    title: "Connections",
    description: "Linking notes and open loops."
  }
];

export const createReviewState = (deps: ReviewDeps) => {
  const [internalReviewSummary, setInternalReviewSummary] =
    createSignal<ReviewQueueSummary>({
      due_count: 0,
      next_due_at: null
    });
  const [internalReviewItems, setInternalReviewItems] = createSignal<
    ReviewQueueItem[]
  >([]);
  const [internalReviewBusy, setInternalReviewBusy] = createSignal(false);
  const [internalReviewMessage, setInternalReviewMessage] = createSignal<
    string | null
  >(null);
  const [internalSelectedReviewTemplate, setInternalSelectedReviewTemplate] =
    createSignal("daily-brief");

  const reviewSummary = deps.state?.reviewSummary ?? internalReviewSummary;
  const setReviewSummary =
    deps.state?.setReviewSummary ?? setInternalReviewSummary;
  const reviewItems = deps.state?.reviewItems ?? internalReviewItems;
  const setReviewItems = deps.state?.setReviewItems ?? setInternalReviewItems;
  const reviewBusy = deps.state?.reviewBusy ?? internalReviewBusy;
  const setReviewBusy = deps.state?.setReviewBusy ?? setInternalReviewBusy;
  const reviewMessage = deps.state?.reviewMessage ?? internalReviewMessage;
  const setReviewMessage =
    deps.state?.setReviewMessage ?? setInternalReviewMessage;
  const selectedReviewTemplate =
    deps.state?.selectedReviewTemplate ?? internalSelectedReviewTemplate;
  const setSelectedReviewTemplate =
    deps.state?.setSelectedReviewTemplate ??
    setInternalSelectedReviewTemplate;

  const addReviewItem = async (blockId: string) => {
    if (!deps.isTauri()) {
      setReviewMessage("Review queue is only available in the desktop app.");
      return;
    }
    const pageUid = deps.resolvePageUid(deps.activePageUid());
    setReviewMessage(null);
    try {
      await deps.invoke("add_review_queue_item", {
        pageUid,
        page_uid: pageUid,
        blockUid: blockId,
        block_uid: blockId
      });
      setReviewMessage("Added to review queue.");
      await deps.loadReviewSummary();
      await deps.loadReviewQueue();
    } catch (error) {
      console.error("Failed to add review item", error);
      setReviewMessage("Unable to add to review queue.");
    }
  };

  const handleReviewAction = async (item: ReviewQueueItem, action: string) => {
    if (!deps.isTauri()) return;
    setReviewBusy(true);
    try {
      await deps.invoke("update_review_queue_item", {
        payload: {
          id: item.id,
          action
        }
      });
      await deps.loadReviewSummary();
      await deps.loadReviewQueue();
    } catch (error) {
      console.error("Failed to update review item", error);
    } finally {
      setReviewBusy(false);
    }
  };

  const createReviewTemplate = async () => {
    if (!deps.isTauri()) {
      setReviewMessage("Templates require the desktop app.");
      return;
    }
    const template = reviewTemplates.find(
      (entry) => entry.id === selectedReviewTemplate()
    );
    if (!template) return;
    setReviewBusy(true);
    try {
      const today = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
      const pageUid = `review-${today}`;
      await deps.invoke("create_review_template", {
        payload: {
          page_uid: pageUid,
          template: template.id,
          title: `${template.title} · ${today}`
        }
      });
      setReviewMessage(`${template.title} template queued for review.`);
      await deps.loadPages();
      await deps.loadReviewSummary();
      await deps.loadReviewQueue();
    } catch (error) {
      console.error("Failed to create review template", error);
      setReviewMessage("Unable to create review template.");
    } finally {
      setReviewBusy(false);
    }
  };

  return {
    reviewSummary,
    setReviewSummary,
    reviewItems,
    setReviewItems,
    reviewBusy,
    setReviewBusy,
    reviewMessage,
    setReviewMessage,
    reviewTemplates,
    selectedReviewTemplate,
    setSelectedReviewTemplate,
    formatReviewDate,
    addReviewItem,
    handleReviewAction,
    createReviewTemplate
  };
};
