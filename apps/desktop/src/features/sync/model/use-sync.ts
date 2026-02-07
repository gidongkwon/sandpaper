import { createMemo, createSignal, type Accessor } from "solid-js";
import { createStore, type SetStoreFunction } from "solid-js/store";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../../../entities/page/model/page-types";
import type {
  SyncApplyResult,
  SyncConfig,
  SyncConflict,
  SyncLogEntry,
  SyncOpEnvelope,
  SyncServerPullResponse,
  SyncServerPushResponse,
  SyncStatus
} from "../../../entities/sync/model/sync-types";
import type { VaultKeyStatus } from "../../../entities/vault/model/vault-types";
import type { PageId } from "../../../shared/model/id-types";
import { resolveBlockType } from "../../../shared/lib/blocks/block-type-utils";

const SYNC_BATCH_LIMIT = 200;
const SYNC_INTERVAL_MS = 8000;
const SYNC_MAX_BACKOFF_MS = 60000;

export const buildSyncStateLabel = (
  connected: boolean,
  status: SyncStatus
) => {
  if (!connected) return "Not connected";
  switch (status.state) {
    case "syncing":
      return "Syncing";
    case "offline":
      return "Offline";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
};

export const buildSyncStateDetail = (options: {
  isTauri: boolean;
  connected: boolean;
  status: SyncStatus;
}) => {
  if (!options.isTauri) {
    return "Desktop app required for background sync.";
  }
  if (!options.connected) {
    return "Connect a server to sync across devices.";
  }
  if (options.status.state === "offline") {
    return "Offline. Edits stay queued until you reconnect.";
  }
  if (options.status.state === "error") {
    return options.status.last_error ?? "Sync error.";
  }
  if (options.status.state === "syncing") {
    return "Syncing in the background.";
  }
  return options.status.last_synced_at
    ? `Last sync ${options.status.last_synced_at}`
    : "Ready to sync.";
};

export type SyncDependencies = {
  isTauri: () => boolean;
  invoke: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
  resolvePageUid: (value: string) => PageId;
  activePageUid: Accessor<PageId>;
  pages: Accessor<PageSummary[]>;
  localPages: Record<PageId, LocalPageRecord>;
  getBlocks: () => Block[];
  snapshotBlocks: (items: Block[]) => Block[];
  saveLocalPageSnapshot: (pageUid: PageId, title: string, items: Block[]) => void;
  setBlocks: SetStoreFunction<Block[]>;
  pageTitle: Accessor<string>;
  toPayload: (block: Block) => BlockPayload;
  makeBlock: (
    uid: string,
    text: string,
    indent: number,
    blockType?: Block["block_type"]
  ) => Block;
  persistBlocks: (
    pageUid: PageId,
    payload: BlockPayload[],
    title: string,
    snapshot: Block[]
  ) => Promise<boolean>;
  scheduleShadowWrite: (pageUid?: PageId) => void;
  markSaving: () => void;
  markSaved: () => void;
  markSaveFailed: () => void;
  loadBlocks: (pageUid?: PageId) => Promise<void>;
  vaultKeyStatus: Accessor<VaultKeyStatus>;
  copyToClipboard: (value: string) => Promise<void>;
  makeRandomId: () => string;
  defaultPageUid: PageId;
};

export const createSync = (deps: SyncDependencies) => {
  const [syncConfig, setSyncConfig] = createSignal<SyncConfig | null>(null);
  const [syncServerUrl, setSyncServerUrl] = createSignal("");
  const [syncVaultIdInput, setSyncVaultIdInput] = createSignal("");
  const [syncDeviceIdInput, setSyncDeviceIdInput] = createSignal("");
  const [syncStatus, setSyncStatus] = createSignal<SyncStatus>({
    state: "idle",
    pending_ops: 0,
    last_synced_at: null,
    last_error: null,
    last_push_count: 0,
    last_pull_count: 0,
    last_apply_count: 0
  });
  const [syncMessage, setSyncMessage] = createSignal<string | null>(null);
  const [syncBusy, setSyncBusy] = createSignal(false);
  const [syncLog, setSyncLog] = createSignal<SyncLogEntry[]>([]);
  const [syncConflicts, setSyncConflicts] = createSignal<SyncConflict[]>([]);
  const [syncConflictMergeId, setSyncConflictMergeId] =
    createSignal<string | null>(null);
  const [syncConflictMergeDrafts, setSyncConflictMergeDrafts] = createStore<
    Record<string, string>
  >({});

  let syncTimeout: number | undefined;
  let syncBackoffMs = SYNC_INTERVAL_MS;
  let syncRunning = false;
  let syncLoopEnabled = false;

  const syncConnected = createMemo(() => {
    const config = syncConfig();
    return Boolean(
      config && config.server_url && config.vault_id && config.device_id
    );
  });

  const syncStateLabel = createMemo(() => {
    if (!deps.isTauri()) return "Desktop only";
    return buildSyncStateLabel(syncConnected(), syncStatus());
  });

  const syncStateDetail = createMemo(() =>
    buildSyncStateDetail({
      isTauri: deps.isTauri(),
      connected: syncConnected(),
      status: syncStatus()
    })
  );

  const syncStampNow = () =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date());

  const stampNow = () =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());

  const appendSyncLog = (
    entry: Omit<SyncLogEntry, "id" | "at"> & { at?: string }
  ) => {
    setSyncLog((prev) => {
      const next = [
        ...prev,
        {
          id: deps.makeRandomId(),
          at: entry.at ?? syncStampNow(),
          action: entry.action,
          count: entry.count,
          status: entry.status,
          detail: entry.detail ?? null
        }
      ];
      return next.slice(-10);
    });
  };

  const formatSyncLogLine = (entry: SyncLogEntry) => {
    const status = entry.status === "error" ? " error" : "";
    const detail = entry.detail ? ` (${entry.detail})` : "";
    return `${entry.at} ${entry.action.toUpperCase()} ${entry.count}${status}${detail}`;
  };

  const copySyncLog = async () => {
    const lines = syncLog().map((entry) => formatSyncLogLine(entry));
    await deps.copyToClipboard(lines.join("\n"));
  };

  const mergeSyncConflicts = (incoming: SyncConflict[]) => {
    if (incoming.length === 0) return;
    setSyncConflicts((prev) => {
      const seen = new Set(prev.map((conflict) => conflict.op_id));
      const next = [...prev];
      for (const conflict of incoming) {
        if (!seen.has(conflict.op_id)) {
          next.push(conflict);
          seen.add(conflict.op_id);
        }
      }
      return next;
    });
  };

  const fetchPageBlocks = async (
    pageUid: PageId
  ): Promise<LocalPageRecord | null> => {
    const resolvedUid = deps.resolvePageUid(pageUid);
    if (!deps.isTauri()) {
      const local = deps.localPages[resolvedUid];
      if (!local) return null;
      return {
        uid: resolvedUid,
        title: local.title,
        blocks: deps.snapshotBlocks(local.blocks)
      };
    }
    try {
      const response = (await deps.invoke("load_page_blocks", {
        pageUid: resolvedUid,
        page_uid: resolvedUid
      })) as PageBlocksResponse;
      return {
        uid: resolvedUid,
        title:
          response.title ||
          (resolvedUid === deps.defaultPageUid ? "Inbox" : "Untitled"),
        blocks: response.blocks.map((block) =>
          deps.makeBlock(
            block.uid,
            block.text,
            block.indent,
            resolveBlockType({ text: block.text, block_type: block.block_type })
          )
        )
      };
    } catch (error) {
      console.error("Failed to load page for conflict", error);
      return null;
    }
  };

  const resolveSyncConflict = async (
    conflict: SyncConflict,
    resolution: "local" | "remote" | "merge",
    mergeText?: string
  ) => {
    const resolvedUid = deps.resolvePageUid(conflict.page_uid);
    const resolvedText =
      resolution === "merge"
        ? mergeText ?? ""
        : resolution === "local"
          ? conflict.local_text
          : conflict.remote_text;

    const updateBlocks = (items: Block[]) => {
      const index = items.findIndex((block) => block.id === conflict.block_uid);
      if (index < 0) return null;
      const next = deps.snapshotBlocks(items);
      next[index] = {
        ...next[index],
        text: resolvedText
      };
      return next;
    };

    const saveBlocks = async (items: Block[], title: string) => {
      const next = updateBlocks(items);
      if (!next) return false;
      if (resolvedUid === deps.resolvePageUid(deps.activePageUid())) {
        deps.setBlocks(next);
      } else if (!deps.isTauri()) {
        deps.saveLocalPageSnapshot(resolvedUid, title, next);
      }
      deps.markSaving();
      const payload = next.map((block) => deps.toPayload(block));
      const success = await deps.persistBlocks(resolvedUid, payload, title, next);
      if (success) {
        deps.markSaved();
        if (resolvedUid === deps.resolvePageUid(deps.activePageUid())) {
          deps.scheduleShadowWrite(resolvedUid);
        }
      } else {
        deps.markSaveFailed();
      }
      return success;
    };

    if (resolvedUid === deps.resolvePageUid(deps.activePageUid())) {
      await saveBlocks(deps.snapshotBlocks(deps.getBlocks()), deps.pageTitle());
    } else {
      const record = await fetchPageBlocks(resolvedUid);
      if (!record) return;
      await saveBlocks(record.blocks, record.title);
    }

    setSyncConflicts((prev) =>
      prev.filter((entry) => entry.op_id !== conflict.op_id)
    );
    if (syncConflictMergeId() === conflict.op_id) {
      setSyncConflictMergeId(null);
    }
    setSyncConflictMergeDrafts(conflict.op_id, "");
  };

  const startSyncConflictMerge = (conflict: SyncConflict) => {
    const existing = syncConflictMergeDrafts[conflict.op_id];
    if (!existing) {
      setSyncConflictMergeDrafts(
        conflict.op_id,
        `${conflict.local_text}\n${conflict.remote_text}`
      );
    }
    setSyncConflictMergeId(conflict.op_id);
  };

  const cancelSyncConflictMerge = () => {
    setSyncConflictMergeId(null);
  };

  const getConflictPageTitle = (pageUid: PageId) =>
    deps.pages().find((page) => page.uid === deps.resolvePageUid(pageUid))
      ?.title ?? pageUid;

  const normalizeServerUrl = (value: string) =>
    value.trim().replace(/\/+$/, "");

  const updateSyncStatus = (next: Partial<SyncStatus>) => {
    setSyncStatus((prev) => ({
      ...prev,
      ...next
    }));
  };

  const loadSyncConfig = async () => {
    if (!deps.isTauri()) {
      setSyncConfig(null);
      setSyncServerUrl("");
      setSyncVaultIdInput("");
      setSyncDeviceIdInput("");
      updateSyncStatus({
        state: "idle",
        last_error: null
      });
      stopSyncLoop();
      return;
    }

    try {
      const config = (await deps.invoke("get_sync_config")) as SyncConfig;
      setSyncConfig(config);
      setSyncServerUrl(config.server_url ?? "");
      setSyncVaultIdInput(config.vault_id ?? "");
      setSyncDeviceIdInput(config.device_id ?? "");
      if (config.server_url && config.vault_id && config.device_id) {
        startSyncLoop();
      } else {
        stopSyncLoop();
      }
    } catch (error) {
      console.error("Failed to load sync config", error);
      setSyncConfig(null);
      stopSyncLoop();
    }
  };

  const setSyncConfigState = (config: SyncConfig) => {
    setSyncConfig(config);
    setSyncServerUrl(config.server_url ?? "");
    setSyncVaultIdInput(config.vault_id ?? "");
    setSyncDeviceIdInput(config.device_id ?? "");
  };

  const pushSyncOps = async (config: SyncConfig) => {
    let cursor = config.last_push_cursor;
    let pushed = 0;
    let iterations = 0;
    const serverUrl = normalizeServerUrl(config.server_url ?? "");
    if (!serverUrl) return { pushed, cursor };

    while (iterations < 3) {
      const ops = (await deps.invoke("list_sync_ops_since", {
        cursor,
        limit: SYNC_BATCH_LIMIT
      })) as SyncOpEnvelope[];
      updateSyncStatus({
        pending_ops: ops.length
      });
      if (ops.length === 0) break;

      const response = await fetch(`${serverUrl}/v1/ops/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vaultId: config.vault_id,
          deviceId: config.device_id,
          ops: ops.map((op) => ({
            opId: op.op_id,
            payload: op.payload
          }))
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "push-failed");
        throw new Error(text || "push-failed");
      }

      const result = (await response.json()) as SyncServerPushResponse;
      const lastCursor = ops[ops.length - 1]?.cursor ?? cursor;
      cursor = lastCursor;
      pushed += result.accepted ?? ops.length;
      const nextConfig = (await deps.invoke("set_sync_cursors", {
        lastPushCursor: cursor,
        last_push_cursor: cursor
      })) as SyncConfig;
      setSyncConfig(nextConfig);

      if (ops.length < SYNC_BATCH_LIMIT) break;
      iterations += 1;
    }

    return { pushed, cursor };
  };

  const pullSyncOps = async (config: SyncConfig) => {
    const serverUrl = normalizeServerUrl(config.server_url ?? "");
    if (!serverUrl || !config.vault_id) {
      return { pulled: 0, cursor: config.last_pull_cursor };
    }
    const response = await fetch(
      `${serverUrl}/v1/ops/pull?vaultId=${encodeURIComponent(
        config.vault_id
      )}&since=${config.last_pull_cursor}&limit=${SYNC_BATCH_LIMIT}`,
      {
        method: "GET"
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "pull-failed");
      throw new Error(text || "pull-failed");
    }

    const payload = (await response.json()) as SyncServerPullResponse;
    const remoteOps = payload.ops
      .filter((op) => op.deviceId !== config.device_id)
      .map((op) => ({
        cursor: op.cursor,
        op_id: op.opId,
        payload: op.payload
      }));
    if (remoteOps.length > 0) {
      await deps.invoke("store_sync_inbox_ops", { ops: remoteOps });
    }
    const nextCursor = payload.nextCursor ?? config.last_pull_cursor;
    const nextConfig = (await deps.invoke("set_sync_cursors", {
      lastPullCursor: nextCursor,
      last_pull_cursor: nextCursor
    })) as SyncConfig;
    setSyncConfig(nextConfig);
    return { pulled: remoteOps.length, cursor: nextCursor };
  };

  const applySyncInbox = async () => {
    if (!deps.isTauri()) return { pages: [], applied: 0, conflicts: [] };
    const result = (await deps.invoke("apply_sync_inbox")) as SyncApplyResult;
    const conflicts = result.conflicts ?? [];
    if (conflicts.length > 0) {
      mergeSyncConflicts(conflicts);
    }
    if (
      result.applied > 0 &&
      result.pages.includes(deps.resolvePageUid(deps.activePageUid()))
    ) {
      await deps.loadBlocks(deps.activePageUid());
    }
    updateSyncStatus({
      pending_ops: 0,
      last_apply_count: result.applied
    });
    return result;
  };

  const startSyncLoop = () => {
    if (!deps.isTauri()) return;
    syncLoopEnabled = true;
    scheduleSync(1200);
  };

  const stopSyncLoop = () => {
    syncLoopEnabled = false;
    if (syncTimeout) {
      window.clearTimeout(syncTimeout);
      syncTimeout = undefined;
    }
  };

  const scheduleSync = (delay: number) => {
    if (!syncLoopEnabled) return;
    if (syncTimeout) {
      window.clearTimeout(syncTimeout);
    }
    syncTimeout = window.setTimeout(() => {
      void runSyncCycle();
    }, delay);
  };

  const runSyncCycle = async (force = false) => {
    if ((!syncLoopEnabled && !force) || syncRunning) return;
    const config = syncConfig();
    if (!config || !config.server_url || !config.vault_id || !config.device_id) {
      updateSyncStatus({ state: "idle" });
      return;
    }

    syncRunning = true;
    updateSyncStatus({
      state: "syncing",
      last_error: null
    });

    try {
      await applySyncInbox();
      const pushResult = await pushSyncOps(config);
      appendSyncLog({
        action: "push",
        count: pushResult.pushed,
        status: "ok"
      });
      const nextConfig = syncConfig() ?? config;
      const pullResult = await pullSyncOps(nextConfig);
      appendSyncLog({
        action: "pull",
        count: pullResult.pulled,
        status: "ok"
      });
      if (pullResult.pulled > 0) {
        await applySyncInbox();
      }
      updateSyncStatus({
        state: "idle",
        last_synced_at: stampNow(),
        last_push_count: pushResult.pushed,
        last_pull_count: pullResult.pulled,
        last_error: null
      });
      syncBackoffMs = SYNC_INTERVAL_MS;
      scheduleSync(SYNC_INTERVAL_MS);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "sync-unavailable";
      const offline = error instanceof TypeError || message.includes("network");
      updateSyncStatus({
        state: offline ? "offline" : "error",
        last_error: message
      });
      syncBackoffMs = Math.min(SYNC_MAX_BACKOFF_MS, syncBackoffMs * 2);
      scheduleSync(syncBackoffMs);
    } finally {
      syncRunning = false;
    }
  };

  const connectSync = async () => {
    if (!deps.isTauri()) return;
    const serverUrl = normalizeServerUrl(syncServerUrl());
    if (!serverUrl) {
      setSyncMessage("Add a sync server URL.");
      return;
    }
    if (!deps.vaultKeyStatus().configured) {
      setSyncMessage("Set a vault passphrase first.");
      return;
    }

    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const keyFingerprint = (await deps.invoke(
        "vault_key_fingerprint"
      )) as string;
      const requestedVaultId = syncVaultIdInput().trim() || undefined;
      const vaultResponse = await fetch(`${serverUrl}/v1/vaults`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          keyFingerprint,
          vaultId: requestedVaultId
        })
      });
      if (!vaultResponse.ok) {
        const text = await vaultResponse.text().catch(() => "vault-failed");
        throw new Error(text || "vault-failed");
      }
      const { vaultId } = (await vaultResponse.json()) as { vaultId: string };
      const deviceResponse = await fetch(`${serverUrl}/v1/devices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vaultId,
          keyFingerprint,
          deviceId: syncDeviceIdInput().trim() || undefined
        })
      });
      if (!deviceResponse.ok) {
        const text = await deviceResponse.text().catch(() => "device-failed");
        throw new Error(text || "device-failed");
      }
      const { deviceId } = (await deviceResponse.json()) as { deviceId: string };
      const config = (await deps.invoke("set_sync_config", {
        serverUrl,
        server_url: serverUrl,
        vaultId,
        vault_id: vaultId,
        deviceId,
        device_id: deviceId,
        keyFingerprint,
        key_fingerprint: keyFingerprint
      })) as SyncConfig;
      setSyncConfigState(config);
      setSyncMessage("Sync connected. Background sync is running.");
      startSyncLoop();
      void runSyncCycle();
    } catch (error) {
      console.error("Failed to connect sync", error);
      setSyncMessage("Sync connection failed.");
      updateSyncStatus({
        state: "error",
        last_error: error instanceof Error ? error.message : "sync-failed"
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const syncNow = async () => {
    if (!deps.isTauri() || syncBusy()) return;
    if (!syncConfig()) {
      await loadSyncConfig();
    }
    await runSyncCycle(true);
  };

  return {
    syncConfig,
    syncServerUrl,
    setSyncServerUrl,
    syncVaultIdInput,
    setSyncVaultIdInput,
    syncDeviceIdInput,
    setSyncDeviceIdInput,
    syncStatus,
    syncMessage,
    syncBusy,
    syncLog,
    syncConflicts,
    syncConflictMergeId,
    syncConflictMergeDrafts,
    setSyncConflictMergeDrafts,
    syncConnected,
    syncStateLabel,
    syncStateDetail,
    loadSyncConfig,
    connectSync,
    syncNow,
    copySyncLog,
    resolveSyncConflict,
    startSyncConflictMerge,
    cancelSyncConflictMerge,
    getConflictPageTitle,
    stopSyncLoop
  };
};
