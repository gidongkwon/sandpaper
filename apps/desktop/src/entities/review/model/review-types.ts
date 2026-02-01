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
