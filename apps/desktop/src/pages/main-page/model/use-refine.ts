import { createSignal, type Accessor } from "solid-js";
import type {
  RefineQueueItem,
  RefineQueueSummary,
  RefineTemplate
} from "../../../entities/refine/model/refine-types";
import { formatRefineDate } from "./refine-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type RefineDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  activePageUid: Accessor<string>;
  resolvePageUid: (value: string) => string;
  loadRefineSummary: () => Promise<void>;
  loadRefineQueue: () => Promise<void>;
  loadPages: () => Promise<void>;
  state?: {
    refineSummary: Accessor<RefineQueueSummary>;
    setRefineSummary: (value: RefineQueueSummary) => void;
    refineItems: Accessor<RefineQueueItem[]>;
    setRefineItems: (value: RefineQueueItem[]) => void;
    refineBusy: Accessor<boolean>;
    setRefineBusy: (value: boolean) => void;
    refineMessage: Accessor<string | null>;
    setRefineMessage: (value: string | null) => void;
    selectedRefineTemplate: Accessor<string>;
    setSelectedRefineTemplate: (value: string) => void;
  };
};

const refineTemplates: RefineTemplate[] = [
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

export const createRefineState = (deps: RefineDeps) => {
  const [internalRefineSummary, setInternalRefineSummary] =
    createSignal<RefineQueueSummary>({
      due_count: 0,
      next_due_at: null
    });
  const [internalRefineItems, setInternalRefineItems] = createSignal<
    RefineQueueItem[]
  >([]);
  const [internalRefineBusy, setInternalRefineBusy] = createSignal(false);
  const [internalRefineMessage, setInternalRefineMessage] = createSignal<
    string | null
  >(null);
  const [internalSelectedRefineTemplate, setInternalSelectedRefineTemplate] =
    createSignal("daily-brief");

  const refineSummary = deps.state?.refineSummary ?? internalRefineSummary;
  const setRefineSummary = deps.state?.setRefineSummary ?? setInternalRefineSummary;
  const refineItems = deps.state?.refineItems ?? internalRefineItems;
  const setRefineItems = deps.state?.setRefineItems ?? setInternalRefineItems;
  const refineBusy = deps.state?.refineBusy ?? internalRefineBusy;
  const setRefineBusy = deps.state?.setRefineBusy ?? setInternalRefineBusy;
  const refineMessage = deps.state?.refineMessage ?? internalRefineMessage;
  const setRefineMessage = deps.state?.setRefineMessage ?? setInternalRefineMessage;
  const selectedRefineTemplate =
    deps.state?.selectedRefineTemplate ?? internalSelectedRefineTemplate;
  const setSelectedRefineTemplate =
    deps.state?.setSelectedRefineTemplate ?? setInternalSelectedRefineTemplate;

  const addRefineItem = async (blockId: string) => {
    if (!deps.isTauri()) {
      setRefineMessage("Refine queue is only available in the desktop app.");
      return;
    }
    const pageUid = deps.resolvePageUid(deps.activePageUid());
    setRefineMessage(null);
    try {
      await deps.invoke("add_refine_queue_item", {
        pageUid,
        page_uid: pageUid,
        blockUid: blockId,
        block_uid: blockId
      });
      setRefineMessage("Added to refine queue.");
      await deps.loadRefineSummary();
      await deps.loadRefineQueue();
    } catch (error) {
      console.error("Failed to add refine item", error);
      setRefineMessage("Unable to add to refine queue.");
    }
  };

  const handleRefineAction = async (item: RefineQueueItem, action: string) => {
    if (!deps.isTauri()) return;
    setRefineBusy(true);
    try {
      await deps.invoke("update_refine_queue_item", {
        payload: {
          id: item.id,
          action
        }
      });
      await deps.loadRefineSummary();
      await deps.loadRefineQueue();
    } catch (error) {
      console.error("Failed to update refine item", error);
    } finally {
      setRefineBusy(false);
    }
  };

  const createRefineTemplate = async () => {
    if (!deps.isTauri()) {
      setRefineMessage("Templates require the desktop app.");
      return;
    }
    const template = refineTemplates.find(
      (entry) => entry.id === selectedRefineTemplate()
    );
    if (!template) return;
    setRefineBusy(true);
    try {
      const today = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
      const pageUid = `refine-${today}`;
      await deps.invoke("create_refine_template", {
        payload: {
          page_uid: pageUid,
          template: template.id,
          title: `${template.title} · ${today}`
        }
      });
      setRefineMessage(`${template.title} template queued for refinement.`);
      await deps.loadPages();
      await deps.loadRefineSummary();
      await deps.loadRefineQueue();
    } catch (error) {
      console.error("Failed to create refine template", error);
      setRefineMessage("Unable to create refinement template.");
    } finally {
      setRefineBusy(false);
    }
  };

  return {
    refineSummary,
    setRefineSummary,
    refineItems,
    setRefineItems,
    refineBusy,
    setRefineBusy,
    refineMessage,
    setRefineMessage,
    refineTemplates,
    selectedRefineTemplate,
    setSelectedRefineTemplate,
    formatRefineDate,
    addRefineItem,
    handleRefineAction,
    createRefineTemplate
  };
};
