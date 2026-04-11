import type { PageId, Timestamp } from "../../../shared/model/id-types";
import type { Block } from "../../block/model/block-types";

export type RefineQueueSummary = {
  due_count: number;
  next_due_at: Timestamp | null;
};

export type RefineQueueItem = {
  id: number;
  page_uid: PageId;
  block_uid: string;
  added_at: Timestamp;
  due_at: Timestamp;
  template?: string | null;
  status: string;
  last_reviewed_at: Timestamp | null;
  text: string;
};

export type RefineTemplate = {
  id: string;
  title: string;
  description: string;
};

export type RefineThreadEntry = {
  id: string;
  text: string;
  is_root: boolean;
  blocks: Block[];
};

export type RefineTab = "to-refine" | "archived";

export type RefineThreadStatus = "to-refine" | "archived";

export type RefineDestinationRecommendation = {
  page_uid: PageId;
  title: string;
  score: number;
  reasons: string[];
  provider: "heuristic" | "ai";
};

export type RefineDestinationSuggestion = {
  page_uid: PageId;
  title: string;
  snippet: string | null;
  reason: string;
  provider: "heuristic" | "rag";
};

export type RefineThreadArchiveRecord = {
  thread_id: string;
  destination_page_uid: PageId;
  archived_at: Timestamp;
  captured_at_start: Timestamp | null;
  captured_at_end: Timestamp | null;
};

export type RefineSessionState = {
  active_thread_id: string | null;
  tab: RefineTab;
  selected_archived_thread_id: string | null;
  destination_page_uid: PageId | null;
  destination_recommendations: RefineDestinationRecommendation[];
  is_hard_selected: boolean;
  baseline_page_hash: string | null;
  last_known_page_hash?: string | null;
  invalidated: boolean;
  updated_at: Timestamp;
};

export type RefineThread = {
  id: string;
  root_text: string;
  entries: RefineThreadEntry[];
  status?: RefineThreadStatus;
  captured_at_start?: Timestamp | null;
  captured_at_end?: Timestamp | null;
  destination_page_uid?: PageId;
  destination_title?: string;
  archived_at?: Timestamp;
};
