import type { PageId, Timestamp } from "../../../shared/model/id-types";

export type ReviewQueueSummary = {
  due_count: number;
  next_due_at: Timestamp | null;
};

export type ReviewQueueItem = {
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

export type ReviewTemplate = {
  id: string;
  title: string;
  description: string;
};

export type ReviewThreadEntry = {
  id: string;
  text: string;
  is_root: boolean;
};

export type ReviewThread = {
  id: string;
  root_text: string;
  entries: ReviewThreadEntry[];
  captured_at_start?: Timestamp | null;
  captured_at_end?: Timestamp | null;
  destination_page_uid?: PageId;
  destination_title?: string;
  archived_at?: Timestamp;
};
