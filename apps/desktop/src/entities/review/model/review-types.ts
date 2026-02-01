export type ReviewQueueSummary = {
  due_count: number;
  next_due_at: number | null;
};

export type ReviewQueueItem = {
  id: number;
  page_uid: string;
  block_uid: string;
  added_at: number;
  due_at: number;
  template?: string | null;
  status: string;
  last_reviewed_at: number | null;
  text: string;
};

export type ReviewTemplate = {
  id: string;
  title: string;
  description: string;
};
