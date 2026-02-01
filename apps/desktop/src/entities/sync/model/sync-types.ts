import type { PageId, Timestamp, VaultId } from "../../../shared/model/id-types";

export type SyncConfig = {
  server_url: string | null;
  vault_id: VaultId | null;
  device_id: string | null;
  key_fingerprint: string | null;
  last_push_cursor: number;
  last_pull_cursor: number;
};

export type SyncStatus = {
  state: "idle" | "syncing" | "offline" | "error";
  pending_ops: number;
  last_synced_at: string | null;
  last_error: string | null;
  last_push_count: number;
  last_pull_count: number;
  last_apply_count: number;
};

export type SyncLogEntry = {
  id: string;
  at: string;
  action: "push" | "pull";
  count: number;
  status: "ok" | "error";
  detail?: string | null;
};

export type SyncOpEnvelope = {
  cursor: number;
  op_id: string;
  payload: string;
};

export type SyncServerPushResponse = {
  accepted: number;
  cursor: number | null;
};

export type SyncServerPullResponse = {
  ops: {
    cursor: number;
    opId: string;
    payload: string;
    deviceId: string;
    createdAt: Timestamp;
  }[];
  nextCursor: number;
};

export type SyncApplyResult = {
  pages: PageId[];
  applied: number;
  conflicts?: SyncConflict[];
};

export type SyncConflict = {
  op_id: string;
  page_uid: PageId;
  block_uid: string;
  local_text: string;
  remote_text: string;
};
