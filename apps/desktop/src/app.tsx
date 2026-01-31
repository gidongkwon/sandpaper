import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import {
  buildBacklinks,
  createShadowWriter,
  parseMarkdownPage,
  serializePageToMarkdown
} from "@sandpaper/core-model";
import { deriveVaultKey } from "@sandpaper/crypto";
import {
  createFpsMeter,
  createPerfTracker,
  type PerfStats
} from "./editor/perf";
import { getVirtualRange } from "./editor/virtual-list";
import "./app.css";

type Block = {
  id: string;
  text: string;
  indent: number;
};

type Mode = "quick-capture" | "editor" | "review";

type VaultRecord = {
  id: string;
  name: string;
  path: string;
};

type VaultConfig = {
  active_id?: string | null;
  vaults: VaultRecord[];
};

type VaultKeyStatus = {
  configured: boolean;
  kdf: string | null;
  iterations: number | null;
  salt_b64: string | null;
};

type SyncConfig = {
  server_url: string | null;
  vault_id: string | null;
  device_id: string | null;
  key_fingerprint: string | null;
  last_push_cursor: number;
  last_pull_cursor: number;
};

type SyncStatus = {
  state: "idle" | "syncing" | "offline" | "error";
  pending_ops: number;
  last_synced_at: string | null;
  last_error: string | null;
  last_push_count: number;
  last_pull_count: number;
  last_apply_count: number;
};

type SyncOpEnvelope = {
  cursor: number;
  op_id: string;
  payload: string;
};

type SyncServerPushResponse = {
  accepted: number;
  cursor: number | null;
};

type SyncServerPullResponse = {
  ops: {
    cursor: number;
    opId: string;
    payload: string;
    deviceId: string;
    createdAt: number;
  }[];
  nextCursor: number;
};

type SyncApplyResult = {
  pages: string[];
  applied: number;
};

type ReviewQueueSummary = {
  due_count: number;
  next_due_at: number | null;
};

type ReviewQueueItem = {
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

type ReviewTemplate = {
  id: string;
  title: string;
  description: string;
};

type SearchResult = {
  id: string;
  text: string;
};

type BlockSearchResult = {
  id: number;
  uid: string;
  text: string;
};

type BlockPayload = {
  uid: string;
  text: string;
  indent: number;
};

type PageBlocksResponse = {
  page_uid: string;
  title: string;
  blocks: BlockPayload[];
};

type BacklinkEntry = {
  id: string;
  text: string;
};

type MarkdownExportStatus = {
  path: string;
  pages: number;
};

type PluginPermissionInfo = {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  permissions: string[];
  enabled: boolean;
  path: string;
  granted_permissions: string[];
  missing_permissions: string[];
};

type PluginBlockInfo = {
  id: string;
  reason: string;
  missing_permissions: string[];
};

type PluginRuntimeStatus = {
  loaded: string[];
  blocked: PluginBlockInfo[];
  commands: PluginCommand[];
  panels: PluginPanel[];
  toolbar_actions: PluginToolbarAction[];
  renderers: PluginRenderer[];
};

type PluginCommand = {
  plugin_id: string;
  id: string;
  title: string;
  description?: string | null;
};

type PluginPanel = {
  plugin_id: string;
  id: string;
  title: string;
  location?: string | null;
};

type PluginToolbarAction = {
  plugin_id: string;
  id: string;
  title: string;
  tooltip?: string | null;
};

type PluginRenderer = {
  plugin_id: string;
  id: string;
  title: string;
  kind: string;
};

type CodeFence = {
  lang: string;
  content: string;
};

type PermissionPrompt = {
  pluginId: string;
  pluginName: string;
  permission: string;
};

let nextId = 1;
const ROW_HEIGHT = 44;
const OVERSCAN = 6;
const DEFAULT_PAGE_UID = "inbox";

const makeLocalId = () => `b${nextId++}`;
const makeRandomId = () => globalThis.crypto?.randomUUID?.() ?? makeLocalId();

const makeBlock = (id: string, text = "", indent = 0): Block => ({
  id,
  text,
  indent
});

const DIAGRAM_LANGS = new Set(["mermaid", "diagram"]);

const parseInlineFence = (text: string): CodeFence | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return null;
  const rest = trimmed.slice(3).trim();
  if (!rest) return null;
  const [lang, ...codeParts] = rest.split(/\s+/);
  if (!lang || codeParts.length === 0) return null;
  return {
    lang: lang.toLowerCase(),
    content: codeParts.join(" ")
  };
};

const MAX_SEED_BLOCKS = 200_000;

const buildSeedBlocks = (idFactory: () => string, count: number): Block[] => {
  const core = [
    { text: "Sandpaper outline prototype", indent: 0 },
    { text: "Enter to add a block", indent: 1 },
    { text: "Tab to indent, Shift+Tab to outdent", indent: 1 },
    { text: "Backspace on empty removes the block", indent: 1 }
  ];
  const total = Math.max(1, Math.min(count, MAX_SEED_BLOCKS));
  const fillerCount = Math.max(0, total - core.length);
  const filler = Array.from({ length: fillerCount }, (_, index) => ({
    text: `Draft line ${index + 1}`,
    indent: index % 3
  }));

  return [...core, ...filler]
    .slice(0, total)
    .map(({ text, indent }) => makeBlock(idFactory(), text, indent));
};

const getSeedCount = (): number | null => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const buildDefaultBlocks = (idFactory: () => string): Block[] => {
  const core = [
    { text: "Sandpaper outline prototype", indent: 0 },
    { text: "Enter to add a block", indent: 1 },
    { text: "Tab to indent, Shift+Tab to outdent", indent: 1 },
    { text: "Backspace on empty removes the block", indent: 1 }
  ];
  const filler = Array.from({ length: 60 }, (_, index) => ({
    text: `Draft line ${index + 1}`,
    indent: index % 3
  }));

  return [...core, ...filler].map(({ text, indent }) =>
    makeBlock(idFactory(), text, indent)
  );
};

const buildLocalDefaults = () => buildDefaultBlocks(makeLocalId);
const defaultBlocks = buildLocalDefaults();
const resolveInitialBlocks = () => {
  const seedCount = getSeedCount();
  if (seedCount) {
    return buildSeedBlocks(makeLocalId, seedCount);
  }
  return defaultBlocks;
};

function App() {
  const initialBlocks = resolveInitialBlocks();
  const [blocks, setBlocks] = createStore<Block[]>([
    ...initialBlocks
  ]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<Mode>("editor");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchFilter, setSearchFilter] = createSignal<
    "all" | "links" | "tasks" | "pinned"
  >("all");
  const [captureText, setCaptureText] = createSignal("");
  const [jumpToId, setJumpToId] = createSignal<string | null>(null);
  const [vaults, setVaults] = createSignal<VaultRecord[]>([]);
  const [activeVault, setActiveVault] = createSignal<VaultRecord | null>(null);
  const [vaultFormOpen, setVaultFormOpen] = createSignal(false);
  const [newVaultName, setNewVaultName] = createSignal("");
  const [newVaultPath, setNewVaultPath] = createSignal("");
  const [vaultPassphrase, setVaultPassphrase] = createSignal("");
  const [vaultKeyStatus, setVaultKeyStatus] = createSignal<VaultKeyStatus>({
    configured: false,
    kdf: null,
    iterations: null,
    salt_b64: null
  });
  const [vaultKeyBusy, setVaultKeyBusy] = createSignal(false);
  const [vaultKeyMessage, setVaultKeyMessage] = createSignal<string | null>(
    null
  );
  const [reviewSummary, setReviewSummary] = createSignal<ReviewQueueSummary>({
    due_count: 0,
    next_due_at: null
  });
  const [reviewItems, setReviewItems] = createSignal<ReviewQueueItem[]>([]);
  const [reviewBusy, setReviewBusy] = createSignal(false);
  const [reviewMessage, setReviewMessage] = createSignal<string | null>(null);
  const [selectedReviewTemplate, setSelectedReviewTemplate] =
    createSignal("daily-brief");
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
  const [pageTitle, setPageTitle] = createSignal("Inbox");
  const [plugins, setPlugins] = createSignal<PluginPermissionInfo[]>([]);
  const [pluginStatus, setPluginStatus] = createSignal<PluginRuntimeStatus | null>(
    null
  );
  const [permissionPrompt, setPermissionPrompt] =
    createSignal<PermissionPrompt | null>(null);
  const [autosaved, setAutosaved] = createSignal(false);
  const [autosaveStamp, setAutosaveStamp] = createSignal("");
  const [importText, setImportText] = createSignal("");
  const [importStatus, setImportStatus] = createSignal<{
    state: "success" | "error";
    message: string;
  } | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [exportStatus, setExportStatus] = createSignal<{
    state: "success" | "error";
    message: string;
    preview?: string;
  } | null>(null);
  const [exporting, setExporting] = createSignal(false);
  const [activePanel, setActivePanel] = createSignal<PluginPanel | null>(null);
  const [commandStatus, setCommandStatus] = createSignal<string | null>(null);
  const [pluginBusy, setPluginBusy] = createSignal(false);
  const [perfEnabled, setPerfEnabled] = createSignal(false);
  const [perfStats, setPerfStats] = createSignal<PerfStats>({
    count: 0,
    last: null,
    p50: null,
    p95: null
  });
  const [scrollFps, setScrollFps] = createSignal(0);

  const renderersByKind = createMemo(() => {
    const map = new Map<string, PluginRenderer>();
    for (const renderer of pluginStatus()?.renderers ?? []) {
      if (!map.has(renderer.kind)) {
        map.set(renderer.kind, renderer);
      }
    }
    return map;
  });

  const findPlugin = (pluginId: string) =>
    plugins().find((plugin) => plugin.id === pluginId) ?? null;

  const hasPermission = (pluginId: string, permission: string) => {
    const plugin = findPlugin(pluginId);
    if (!plugin) return false;
    return plugin.granted_permissions.includes(permission);
  };

  const perfTracker = createPerfTracker({
    maxSamples: 160,
    onSample: () => {
      if (perfEnabled()) {
        setPerfStats(perfTracker.getStats());
      }
    }
  });
  const scrollMeter = createFpsMeter({
    onUpdate: (fps) => {
      if (perfEnabled()) {
        setScrollFps(fps);
      }
    }
  });
  const SYNC_BATCH_LIMIT = 200;
  const SYNC_INTERVAL_MS = 8000;
  const SYNC_MAX_BACKOFF_MS = 60000;
  let syncTimeout: number | undefined;
  let syncBackoffMs = SYNC_INTERVAL_MS;
  let syncRunning = false;
  let syncLoopEnabled = false;

  const isTauri = () =>
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");

  const fallbackPlugins: PluginPermissionInfo[] = [
    {
      id: "local-calendar",
      name: "Local Calendar",
      version: "0.1.0",
      description: "Daily agenda panel",
      permissions: ["fs", "network", "data.write", "ui"],
      enabled: true,
      path: "/plugins/local-calendar",
      granted_permissions: ["fs", "data.write", "ui"],
      missing_permissions: ["network"]
    },
    {
      id: "focus-mode",
      name: "Focus Mode",
      version: "0.2.0",
      description: "Minimal editor layout",
      permissions: ["ui"],
      enabled: true,
      path: "/plugins/focus-mode",
      granted_permissions: [],
      missing_permissions: ["ui"]
    },
    {
      id: "insight-lens",
      name: "Insight Lens",
      version: "0.1.0",
      description: "Context-aware capture helper",
      permissions: ["data.write"],
      enabled: true,
      path: "/plugins/insight-lens",
      granted_permissions: [],
      missing_permissions: ["data.write"]
    }
  ];

  const fallbackPluginStatus: PluginRuntimeStatus = {
    loaded: ["local-calendar", "focus-mode", "insight-lens"],
    blocked: [],
    commands: [
      {
        plugin_id: "local-calendar",
        id: "local-calendar.open",
        title: "Open local-calendar",
        description: "Open local-calendar panel"
      },
      {
        plugin_id: "insight-lens",
        id: "insight-lens.capture",
        title: "Capture highlight",
        description: "Append a capture block"
      }
    ],
    panels: [
      {
        plugin_id: "local-calendar",
        id: "local-calendar.panel",
        title: "Calendar panel",
        location: "sidebar"
      },
      {
        plugin_id: "focus-mode",
        id: "focus-mode.panel",
        title: "Focus panel",
        location: "sidebar"
      }
    ],
    toolbar_actions: [
      {
        plugin_id: "local-calendar",
        id: "local-calendar.toolbar",
        title: "Today focus",
        tooltip: "Jump to today"
      }
    ],
    renderers: [
      {
        plugin_id: "local-calendar",
        id: "local-calendar.renderer.code",
        title: "Code block renderer",
        kind: "code"
      },
      {
        plugin_id: "local-calendar",
        id: "local-calendar.renderer.diagram",
        title: "Diagram renderer",
        kind: "diagram"
      }
    ]
  };

  const localSearch = (query: string): SearchResult[] => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return blocks
      .filter((block) => block.text.toLowerCase().includes(normalized))
      .slice(0, 12)
      .map((block) => ({ id: block.id, text: block.text }));
  };

  const localResults = createMemo<SearchResult[]>(() => {
    const trimmed = searchQuery().trim();
    if (!trimmed) return [];
    return localSearch(trimmed);
  });

  const [remoteResults] = createResource(
    searchQuery,
    async (query) => {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (!isTauri()) return [];

      try {
        const remote = (await invoke("search_blocks", { query: trimmed })) as
          | BlockSearchResult[]
          | null;
        if (remote && remote.length > 0) {
          return remote.map((block) => ({ id: block.uid, text: block.text }));
        }
      } catch (error) {
        console.error("Search failed", error);
      }

      return [];
    },
    { initialValue: [] }
  );

  const searchResults = createMemo<SearchResult[]>(() =>
    isTauri() ? remoteResults() : localResults()
  );

  const backlinksMap = createMemo(() =>
    buildBacklinks(
      blocks.map((block) => ({
        id: block.id,
        text: block.text
      }))
    )
  );

  const activeBlock = createMemo(
    () => blocks.find((block) => block.id === activeId()) ?? null
  );

  const activeBacklinks = createMemo<BacklinkEntry[]>(() => {
    const active = activeId();
    if (!active) return [];
    const linked = backlinksMap()[active] ?? [];
    return linked
      .map((id) => blocks.find((block) => block.id === id))
      .filter((block): block is Block => Boolean(block))
      .map((block) => ({ id: block.id, text: block.text || "Untitled" }));
  });

  const filteredSearchResults = createMemo<SearchResult[]>(() => {
    const results = searchResults();
    if (searchFilter() === "all") return results;
    if (searchFilter() === "links") {
      return results.filter((result) => result.text.includes("(("));
    }
    if (searchFilter() === "tasks") {
      return results.filter((result) => /\[\s?[xX ]\s?\]/.test(result.text));
    }
    if (searchFilter() === "pinned") {
      return results.filter((result) => result.text.toLowerCase().includes("#pin"));
    }
    return results;
  });

  const syncConnected = createMemo(() => {
    const config = syncConfig();
    return Boolean(config?.server_url && config?.vault_id && config?.device_id);
  });

  const syncStateLabel = createMemo(() => {
    if (!isTauri()) return "Desktop only";
    if (!syncConnected()) return "Not connected";
    switch (syncStatus().state) {
      case "syncing":
        return "Syncing";
      case "offline":
        return "Offline";
      case "error":
        return "Error";
      default:
        return "Ready";
    }
  });

  const syncStateDetail = createMemo(() => {
    if (!isTauri()) {
      return "Desktop app required for background sync.";
    }
    if (!syncConnected()) {
      return "Connect a server to sync across devices.";
    }
    if (syncStatus().state === "offline") {
      return "Offline. Edits stay queued until you reconnect.";
    }
    if (syncStatus().state === "error") {
      return syncStatus().last_error ?? "Sync error.";
    }
    if (syncStatus().state === "syncing") {
      return "Syncing in the background.";
    }
    return syncStatus().last_synced_at
      ? `Last sync ${syncStatus().last_synced_at}`
      : "Ready to sync.";
  });

  const shadowWriter = createShadowWriter({
    resolvePath: (pageId) => pageId,
    writeFile: async (pageId, content) => {
      if (!isTauri()) return;
      await invoke("write_shadow_markdown", {
        pageUid: pageId,
        page_uid: pageId,
        content
      });
    }
  });

  const createNewBlock = (text = "", indent = 0) =>
    makeBlock(isTauri() ? makeRandomId() : makeLocalId(), text, indent);

  const toPayload = (block: Block): BlockPayload => ({
    uid: block.id,
    text: block.text,
    indent: block.indent
  });

  const formatReviewDate = (timestamp: number | null) => {
    if (!timestamp) return "—";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  };

  const loadReviewSummary = async () => {
    if (!isTauri()) {
      setReviewSummary({ due_count: 0, next_due_at: null });
      return;
    }
    try {
      const summary = (await invoke("review_queue_summary")) as ReviewQueueSummary;
      setReviewSummary(summary);
    } catch (error) {
      console.error("Failed to load review summary", error);
    }
  };

  const loadReviewQueue = async () => {
    if (!isTauri()) {
      setReviewItems([]);
      return;
    }
    setReviewBusy(true);
    try {
      const items = (await invoke("list_review_queue_due", {
        limit: 12
      })) as ReviewQueueItem[];
      setReviewItems(items);
    } catch (error) {
      console.error("Failed to load review queue", error);
    } finally {
      setReviewBusy(false);
    }
  };

  const addReviewItem = async (blockId: string) => {
    if (!isTauri()) {
      setReviewMessage("Review queue is only available in the desktop app.");
      return;
    }
    const pageUid = DEFAULT_PAGE_UID;
    setReviewMessage(null);
    try {
      await invoke("add_review_queue_item", {
        pageUid,
        page_uid: pageUid,
        blockUid: blockId,
        block_uid: blockId
      });
      setReviewMessage("Added to review queue.");
      await loadReviewSummary();
      await loadReviewQueue();
    } catch (error) {
      console.error("Failed to add review item", error);
      setReviewMessage("Unable to add to review queue.");
    }
  };

  const handleReviewAction = async (item: ReviewQueueItem, action: string) => {
    if (!isTauri()) return;
    setReviewBusy(true);
    try {
      await invoke("update_review_queue_item", {
        id: item.id,
        action
      });
      await loadReviewSummary();
      await loadReviewQueue();
    } catch (error) {
      console.error("Failed to update review item", error);
    } finally {
      setReviewBusy(false);
    }
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

  const createReviewTemplate = async () => {
    if (!isTauri()) {
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
      await invoke("create_review_template", {
        pageUid,
        page_uid: pageUid,
        template: template.id,
        title: `${template.title} · ${today}`
      });
      setReviewMessage(`${template.title} template queued for review.`);
      await loadReviewSummary();
      await loadReviewQueue();
    } catch (error) {
      console.error("Failed to create review template", error);
      setReviewMessage("Unable to create review template.");
    } finally {
      setReviewBusy(false);
    }
  };

  const ReviewPane = () => (
    <div class="review">
      <div class="review__header">
        <div>
          <div class="review__eyebrow">Review mode</div>
          <h2>Daily queue</h2>
          <p>Collect highlights, revisit key blocks, and clear the queue.</p>
        </div>
        <div class="review__summary">
          <div class="review__stat">
            <span>Due now</span>
            <strong>{reviewSummary().due_count}</strong>
          </div>
          <div class="review__stat">
            <span>Next due</span>
            <strong>{formatReviewDate(reviewSummary().next_due_at)}</strong>
          </div>
        </div>
      </div>
      <div class="review__deck">
        <Show
          when={reviewItems().length > 0}
          fallback={
            <div class="review__empty">
              <div>Nothing due yet.</div>
              <div>Tag blocks for review from the editor.</div>
            </div>
          }
        >
          <For each={reviewItems()}>
            {(item) => (
              <article class="review-card">
                <div class="review-card__meta">
                  <span>{item.page_uid}</span>
                  <span>Due {formatReviewDate(item.due_at)}</span>
                </div>
                <div class="review-card__text">{item.text || "Untitled"}</div>
                <div class="review-card__actions">
                  <button
                    class="review-card__button"
                    disabled={reviewBusy()}
                    onClick={() => handleReviewAction(item, "snooze")}
                  >
                    Snooze
                  </button>
                  <button
                    class="review-card__button"
                    disabled={reviewBusy()}
                    onClick={() => handleReviewAction(item, "later")}
                  >
                    Schedule
                  </button>
                  <button
                    class="review-card__button is-primary"
                    disabled={reviewBusy()}
                    onClick={() => handleReviewAction(item, "done")}
                  >
                    Done
                  </button>
                </div>
              </article>
            )}
          </For>
        </Show>
      </div>
      <Show when={reviewMessage()}>
        <div class="review__message">{reviewMessage()}</div>
      </Show>
      <div class="review__templates">
        <div class="review__template-header">
          <div>
            <div class="review__eyebrow">Templates</div>
            <div class="review__subtitle">Seed a daily review page</div>
          </div>
          <button
            class="review__button is-secondary"
            disabled={reviewBusy() || !isTauri()}
            onClick={createReviewTemplate}
          >
            Create template
          </button>
        </div>
        <div class="review__template-grid">
          <For each={reviewTemplates}>
            {(template) => (
              <button
                class={`review-template ${
                  selectedReviewTemplate() === template.id ? "is-active" : ""
                }`}
                onClick={() => setSelectedReviewTemplate(template.id)}
              >
                <div class="review-template__title">{template.title}</div>
                <div class="review-template__desc">{template.description}</div>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="review__actions">
        <button
          class="review__button"
          disabled={!activeId() || !isTauri()}
          onClick={() => {
            const id = activeId();
            if (id) void addReviewItem(id);
          }}
        >
          Add current block to review queue
        </button>
        <Show when={!isTauri()}>
          <span class="review__hint">Desktop app required.</span>
        </Show>
      </div>
    </div>
  );

  let saveTimeout: number | undefined;
  let autosaveTimeout: number | undefined;
  const persistBlocks = async () => {
    if (!isTauri()) return;
    const payload = untrack(() => blocks.map((block) => toPayload(block)));
    try {
      await invoke("save_page_blocks", {
        pageUid: DEFAULT_PAGE_UID,
        page_uid: DEFAULT_PAGE_UID,
        blocks: payload
      });
    } catch (error) {
      console.error("Failed to save blocks", error);
    }
  };

  const scheduleShadowWrite = () => {
    if (!isTauri()) return;
    const snapshot = untrack(() =>
      blocks.map((block) => ({
        id: block.id,
        text: block.text,
        indent: block.indent
      }))
    );
    const title = untrack(() => pageTitle());
    const content = serializePageToMarkdown({
      id: DEFAULT_PAGE_UID,
      title,
      blocks: snapshot
    });
    shadowWriter.scheduleWrite(DEFAULT_PAGE_UID, content);
  };

  const scheduleSave = () => {
    if (!isTauri()) return;
    if (saveTimeout) {
      window.clearTimeout(saveTimeout);
    }
    if (autosaveTimeout) {
      window.clearTimeout(autosaveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
      void persistBlocks();
    }, 400);
    scheduleShadowWrite();
    setAutosaved(false);
    autosaveTimeout = window.setTimeout(() => {
      const time = stampNow();
      setAutosaveStamp(time);
      setAutosaved(true);
    }, 700);
  };

  const stampNow = () =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());

  const loadBlocks = async () => {
    if (!isTauri()) {
      const seedCount = getSeedCount();
      const seeded = seedCount
        ? buildSeedBlocks(makeLocalId, seedCount)
        : buildLocalDefaults();
      setBlocks(seeded);
      setPageTitle("Inbox");
      setAutosaved(true);
      setAutosaveStamp(stampNow());
      return;
    }

    try {
      const response = (await invoke("load_page_blocks", {
        pageUid: DEFAULT_PAGE_UID,
        page_uid: DEFAULT_PAGE_UID
      })) as PageBlocksResponse;
      const loaded = response.blocks.map((block) =>
        makeBlock(block.uid, block.text, block.indent)
      );
      setPageTitle(response.title || "Inbox");
      if (loaded.length === 0) {
        const seeded = buildDefaultBlocks(makeRandomId);
        setBlocks(seeded);
        await invoke("save_page_blocks", {
          pageUid: DEFAULT_PAGE_UID,
          page_uid: DEFAULT_PAGE_UID,
          blocks: seeded.map((block) => toPayload(block))
        });
        const seedMarkdown = serializePageToMarkdown({
          id: DEFAULT_PAGE_UID,
          title: response.title || "Inbox",
          blocks: seeded.map((block) => ({
            id: block.id,
            text: block.text,
            indent: block.indent
          }))
        });
        shadowWriter.scheduleWrite(DEFAULT_PAGE_UID, seedMarkdown);
        setActiveId(seeded[0]?.id ?? null);
        setAutosaved(true);
        setAutosaveStamp(stampNow());
        return;
      }
      setBlocks(loaded);
      setActiveId(loaded[0]?.id ?? null);
      const loadedMarkdown = serializePageToMarkdown({
        id: DEFAULT_PAGE_UID,
        title: response.title || "Inbox",
        blocks: loaded.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
      shadowWriter.scheduleWrite(DEFAULT_PAGE_UID, loadedMarkdown);
      setAutosaved(true);
      setAutosaveStamp(stampNow());
    } catch (error) {
      console.error("Failed to load blocks", error);
      setBlocks(buildLocalDefaults());
      setPageTitle("Inbox");
      setAutosaved(true);
      setAutosaveStamp(stampNow());
    }
  };

  const loadPlugins = async () => {
    if (!isTauri()) {
      setPlugins(fallbackPlugins);
      setPluginStatus(fallbackPluginStatus);
      return;
    }

    try {
      const remote = (await invoke("list_plugins_command")) as PluginPermissionInfo[];
      setPlugins(remote);
    } catch (error) {
      console.error("Failed to load plugins", error);
    }

    await loadPluginRuntime();
  };

  const loadVaultKeyStatus = async () => {
    if (!isTauri()) {
      const stored = localStorage.getItem("sandpaper:vault-key");
      if (stored) {
        const parsed = JSON.parse(stored) as {
          kdf?: string;
          iterations?: number;
          salt_b64?: string;
        };
        setVaultKeyStatus({
          configured: true,
          kdf: parsed.kdf ?? "pbkdf2-sha256",
          iterations: parsed.iterations ?? null,
          salt_b64: parsed.salt_b64 ?? null
        });
        return;
      }
      setVaultKeyStatus({
        configured: false,
        kdf: null,
        iterations: null,
        salt_b64: null
      });
      return;
    }

    try {
      const status = (await invoke("vault_key_status")) as VaultKeyStatus;
      setVaultKeyStatus({
        configured: status.configured,
        kdf: status.kdf ?? null,
        iterations: status.iterations ?? null,
        salt_b64: status.salt_b64 ?? null
      });
    } catch (error) {
      console.error("Failed to load vault key status", error);
      setVaultKeyStatus({
        configured: false,
        kdf: null,
        iterations: null,
        salt_b64: null
      });
    }
  };

  const setVaultKey = async () => {
    const passphrase = vaultPassphrase().trim();
    if (!passphrase) return;
    setVaultKeyBusy(true);
    setVaultKeyMessage(null);
    try {
      const vaultKey = await deriveVaultKey(passphrase);
      if (isTauri()) {
        await invoke("set_vault_key", {
          keyB64: vaultKey.keyB64,
          saltB64: vaultKey.saltB64,
          iterations: vaultKey.iterations
        });
      } else {
        localStorage.setItem(
          "sandpaper:vault-key",
          JSON.stringify({
            kdf: vaultKey.kdf,
            iterations: vaultKey.iterations,
            salt_b64: vaultKey.saltB64
          })
        );
      }
      setVaultKeyStatus({
        configured: true,
        kdf: vaultKey.kdf,
        iterations: vaultKey.iterations,
        salt_b64: vaultKey.saltB64
      });
      setVaultKeyMessage("Vault key derived and stored.");
      setVaultPassphrase("");
    } catch (error) {
      console.error("Failed to derive vault key", error);
      setVaultKeyMessage("Failed to derive vault key.");
    } finally {
      setVaultKeyBusy(false);
    }
  };

  const normalizeServerUrl = (value: string) =>
    value.trim().replace(/\/+$/, "");

  const updateSyncStatus = (next: Partial<SyncStatus>) => {
    setSyncStatus((prev) => ({
      ...prev,
      ...next
    }));
  };

  const loadSyncConfig = async () => {
    if (!isTauri()) {
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
      const config = (await invoke("get_sync_config")) as SyncConfig;
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
      const ops = (await invoke("list_sync_ops_since", {
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
      const nextConfig = (await invoke("set_sync_cursors", {
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
    if (!serverUrl || !config.vault_id) return { pulled: 0, cursor: config.last_pull_cursor };
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
      await invoke("store_sync_inbox_ops", { ops: remoteOps });
    }
    const nextCursor = payload.nextCursor ?? config.last_pull_cursor;
    const nextConfig = (await invoke("set_sync_cursors", {
      lastPullCursor: nextCursor,
      last_pull_cursor: nextCursor
    })) as SyncConfig;
    setSyncConfig(nextConfig);
    return { pulled: remoteOps.length, cursor: nextCursor };
  };

  const applySyncInbox = async () => {
    if (!isTauri()) return { pages: [], applied: 0 };
    const result = (await invoke("apply_sync_inbox")) as SyncApplyResult;
    if (result.applied > 0 && result.pages.includes(DEFAULT_PAGE_UID)) {
      await loadBlocks();
    }
    updateSyncStatus({
      pending_ops: 0,
      last_apply_count: result.applied
    });
    return result;
  };

  const startSyncLoop = () => {
    if (!isTauri()) return;
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

  const runSyncCycle = async () => {
    if (!syncLoopEnabled || syncRunning) return;
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
      const nextConfig = syncConfig() ?? config;
      const pullResult = await pullSyncOps(nextConfig);
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
      const offline =
        error instanceof TypeError || message.includes("network");
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
    if (!isTauri()) return;
    const serverUrl = normalizeServerUrl(syncServerUrl());
    if (!serverUrl) {
      setSyncMessage("Add a sync server URL.");
      return;
    }
    if (!vaultKeyStatus().configured) {
      setSyncMessage("Set a vault passphrase first.");
      return;
    }

    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const keyFingerprint = (await invoke("vault_key_fingerprint")) as string;
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
      const config = (await invoke("set_sync_config", {
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
    if (!isTauri() || syncBusy()) return;
    await runSyncCycle();
  };

  const requestGrantPermission = (plugin: PluginPermissionInfo, permission: string) => {
    setPermissionPrompt({
      pluginId: plugin.id,
      pluginName: plugin.name,
      permission
    });
  };

  const grantPermission = async () => {
    const prompt = permissionPrompt();
    if (!prompt) return;
    if (isTauri()) {
      await invoke("grant_plugin_permission", {
        pluginId: prompt.pluginId,
        permission: prompt.permission
      });
      await loadPlugins();
    }
    setPermissionPrompt(null);
    setAutosaved(true);
    setAutosaveStamp(stampNow());
  };

  const dismissPermissionPrompt = () => {
    setPermissionPrompt(null);
  };

  const loadPluginRuntime = async () => {
    if (!isTauri()) {
      setPluginStatus(fallbackPluginStatus);
      return;
    }
    setPluginBusy(true);
    try {
      const status = (await invoke("load_plugins_command")) as PluginRuntimeStatus;
      setPluginStatus(status);
    } catch (error) {
      console.error("Failed to load plugins", error);
    } finally {
      setPluginBusy(false);
    }
  };

  const importMarkdown = async () => {
    if (importing()) return;
    const raw = importText().trim();
    if (!raw) {
      setImportStatus({
        state: "error",
        message: "Paste Markdown before importing."
      });
      return;
    }
    setImporting(true);
    setImportStatus(null);

    try {
      const parsed = parseMarkdownPage(raw, makeRandomId);
      if (parsed.page.blocks.length === 0) {
        setImportStatus({
          state: "error",
          message: "No list items found to import."
        });
        return;
      }

      const existingIds = new Set(blocks.map((block) => block.id));
      const importedBlocks = parsed.page.blocks.map((block) => {
        let nextId = block.id;
        if (existingIds.has(nextId)) {
          nextId = makeRandomId();
        }
        existingIds.add(nextId);
        return { ...block, id: nextId };
      });

      const nextBlocks = [...blocks, ...importedBlocks];
      setBlocks(nextBlocks);
      if (importedBlocks[0]) {
        setActiveId(importedBlocks[0].id);
        setJumpToId(importedBlocks[0].id);
      }
      const nextTitle =
        parsed.hasHeader && parsed.page.title.trim()
          ? parsed.page.title.trim()
          : pageTitle();
      if (nextTitle !== pageTitle()) {
        setPageTitle(nextTitle);
      }

      if (isTauri()) {
        await invoke("save_page_blocks", {
          pageUid: DEFAULT_PAGE_UID,
          page_uid: DEFAULT_PAGE_UID,
          blocks: nextBlocks.map((block) => toPayload(block))
        });
        if (parsed.hasHeader && nextTitle.trim()) {
          await invoke("set_page_title", {
            pageUid: DEFAULT_PAGE_UID,
            page_uid: DEFAULT_PAGE_UID,
            title: nextTitle.trim()
          });
        }
      }

      const warningSuffix =
        parsed.warnings.length > 0
          ? ` ${parsed.warnings.length} warnings.`
          : "";
      setImportStatus({
        state: "success",
        message: `Imported ${importedBlocks.length} blocks into Inbox.${warningSuffix}`
      });
      setAutosaved(true);
      setAutosaveStamp(stampNow());
      shadowWriter.scheduleWrite(
        DEFAULT_PAGE_UID,
        serializePageToMarkdown({
          id: DEFAULT_PAGE_UID,
          title: nextTitle,
          blocks: nextBlocks.map((block) => ({
            id: block.id,
            text: block.text,
            indent: block.indent
          }))
        })
      );
      setImportText("");
    } catch (error) {
      console.error("Import failed", error);
      setImportStatus({
        state: "error",
        message: "Import failed. Check the logs for details."
      });
    } finally {
      setImporting(false);
    }
  };

  const exportMarkdown = async () => {
    if (exporting()) return;
    setExporting(true);
    setExportStatus(null);

    if (!isTauri()) {
      const markdown = serializePageToMarkdown({
        id: DEFAULT_PAGE_UID,
        title: pageTitle(),
        blocks: blocks.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
      setExportStatus({
        state: "success",
        message: "Preview generated in browser (desktop app required to write files).",
        preview: markdown
      });
      setExporting(false);
      return;
    }

    try {
      const result = (await invoke("export_markdown")) as MarkdownExportStatus;
      setExportStatus({
        state: "success",
        message: `Exported ${result.pages} pages to ${result.path}`
      });
    } catch (error) {
      console.error("Export failed", error);
      setExportStatus({
        state: "error",
        message: "Export failed. Check the logs for details."
      });
    } finally {
      setExporting(false);
    }
  };

  const openPanel = (panel: PluginPanel) => {
    if (!hasPermission(panel.plugin_id, "ui")) {
      const plugin = findPlugin(panel.plugin_id);
      if (plugin) requestGrantPermission(plugin, "ui");
      return;
    }
    setActivePanel(panel);
  };

  const runPluginCommand = async (command: PluginCommand) => {
    if (!hasPermission(command.plugin_id, "data.write")) {
      const plugin = findPlugin(command.plugin_id);
      if (plugin) requestGrantPermission(plugin, "data.write");
      return;
    }

    const text = `Plugin action: ${command.title}`;
    const newBlock = makeBlock(makeRandomId(), text, 0);
    const nextBlocks = [newBlock, ...blocks];
    setBlocks(
      produce((draft) => {
        draft.unshift(newBlock);
      })
    );
    scheduleSave();
    setCommandStatus(`Ran ${command.id}`);

    if (!isTauri()) return;

    try {
      await invoke("plugin_write_page", {
        pluginId: command.plugin_id,
        plugin_id: command.plugin_id,
        pageUid: DEFAULT_PAGE_UID,
        page_uid: DEFAULT_PAGE_UID,
        blocks: nextBlocks.map((block) => ({
          uid: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
    } catch (error) {
      console.error("Plugin command failed", error);
    }
  };

  const loadVaults = async () => {
    if (!isTauri()) {
      const fallback = {
        id: "local",
        name: "Sandpaper",
        path: "/vaults/sandpaper"
      };
      setVaults([fallback]);
      setActiveVault(fallback);
      await loadBlocks();
      await loadPlugins();
      await loadVaultKeyStatus();
      await loadSyncConfig();
      await loadReviewSummary();
      await loadReviewQueue();
      return;
    }

    try {
      const config = (await invoke("list_vaults")) as VaultConfig;
      const entries = config.vaults ?? [];
      setVaults(entries);
      const active =
        entries.find((vault) => vault.id === config.active_id) ??
        entries[0] ??
        null;
      setActiveVault(active);
      await loadBlocks();
      await loadPlugins();
      await loadVaultKeyStatus();
      await loadSyncConfig();
      await loadReviewSummary();
      await loadReviewQueue();
    } catch (error) {
      console.error("Failed to load vaults", error);
    }
  };

  const applyActiveVault = async (vaultId: string) => {
    const nextVault = vaults().find((vault) => vault.id === vaultId) ?? null;
    setActiveVault(nextVault);
    if (!isTauri()) return;
    await invoke("set_active_vault", {
      vaultId,
      vault_id: vaultId
    });
    setExportStatus(null);
    setActivePanel(null);
    setCommandStatus(null);
    await loadBlocks();
    await loadPlugins();
    await loadVaultKeyStatus();
    await loadSyncConfig();
    await loadReviewSummary();
    await loadReviewQueue();
  };

  const createVault = async () => {
    const name = newVaultName().trim();
    const path = newVaultPath().trim();
    if (!name || !path) return;

    if (isTauri()) {
      await invoke("create_vault", { name, path });
      await loadVaults();
    } else {
      const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`;
      const record = { id, name, path };
      setVaults((prev) => [...prev, record]);
      setActiveVault(record);
      await loadBlocks();
      await loadPlugins();
      await loadVaultKeyStatus();
      await loadSyncConfig();
      await loadReviewSummary();
      await loadReviewQueue();
    }

    setVaultFormOpen(false);
    setNewVaultName("");
    setNewVaultPath("");
    setAutosaved(true);
    setAutosaveStamp(
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date())
    );
  };

  onMount(() => {
    const perfFlag =
      new URLSearchParams(window.location.search).has("perf") ||
      localStorage.getItem("sandpaper:perf") === "1";
    setPerfEnabled(perfFlag);
    if (perfFlag) {
      setPerfStats(perfTracker.getStats());
    }

    void loadVaults();

    onCleanup(() => {
      scrollMeter.dispose();
      if (saveTimeout) {
        window.clearTimeout(saveTimeout);
      }
      if (autosaveTimeout) {
        window.clearTimeout(autosaveTimeout);
      }
      void shadowWriter.flush();
      shadowWriter.dispose();
      stopSyncLoop();
    });
  });

  const recordLatency = (label: string) => {
    if (!perfEnabled()) return;
    perfTracker.mark(label);
  };

  const addCapture = () => {
    const text = captureText().trim();
    if (!text) return;
    const block = createNewBlock(text, 0);
    setBlocks(
      produce((draft) => {
        draft.unshift(block);
      })
    );
    scheduleSave();
    setCaptureText("");
    setMode("editor");
    setActiveId(block.id);
  };

  const EditorPane = (props: { title: string; meta: string }) => {
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);
    const inputRefs = new Map<string, HTMLTextAreaElement>();
    let editorRef: HTMLDivElement | undefined;
    const effectiveViewport = createMemo(() =>
      viewportHeight() === 0 ? 560 : viewportHeight()
    );

    const range = createMemo(() =>
      getVirtualRange({
        count: blocks.length,
        rowHeight: ROW_HEIGHT,
        overscan: OVERSCAN,
        scrollTop: scrollTop(),
        viewportHeight: effectiveViewport()
      })
    );

    const visibleBlocks = createMemo(() =>
      blocks.slice(range().start, range().end)
    );

    onMount(() => {
      if (!editorRef) return;
      setViewportHeight(editorRef.clientHeight);
      setScrollTop(editorRef.scrollTop);
      if (!activeId() && blocks.length > 0) {
        setActiveId(blocks[0].id);
      }

      const handleScroll = () => {
        setScrollTop(editorRef?.scrollTop ?? 0);
        if (perfEnabled()) {
          scrollMeter.notifyScroll();
        }
      };
      editorRef.addEventListener("scroll", handleScroll);

      const resizeObserver = new ResizeObserver(() => {
        if (!editorRef) return;
        setViewportHeight(editorRef.clientHeight);
      });
      resizeObserver.observe(editorRef);

      onCleanup(() => {
        editorRef?.removeEventListener("scroll", handleScroll);
        resizeObserver.disconnect();
      });
    });

    const scrollToIndex = (index: number) => {
      if (!editorRef || viewportHeight() === 0) return;
      const top = index * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      const viewTop = editorRef.scrollTop;
      const viewBottom = viewTop + viewportHeight();
      if (top < viewTop) {
        editorRef.scrollTop = top;
      } else if (bottom > viewBottom) {
        editorRef.scrollTop = bottom - viewportHeight();
      }
    };

    const findIndexById = (id: string) =>
      blocks.findIndex((block) => block.id === id);

    const focusBlock = (id: string, caret: "start" | "end" = "end") => {
      const index = findIndexById(id);
      if (index >= 0) scrollToIndex(index);
      setActiveId(id);
      requestAnimationFrame(() => {
        const el = inputRefs.get(id);
        if (!el) return;
        el.focus();
        const pos = caret === "start" ? 0 : el.value.length;
        el.setSelectionRange(pos, pos);
      });
    };

    createEffect(() => {
      const targetId = jumpToId();
      if (!targetId) return;
      if (findIndexById(targetId) < 0) return;
      focusBlock(targetId, "start");
    });

    const insertBlockAfter = (index: number, indent: number) => {
      const block = createNewBlock("", indent);
      setBlocks(
        produce((draft) => {
          draft.splice(index + 1, 0, block);
        })
      );
      scheduleSave();
      focusBlock(block.id, "start");
    };

    const removeBlockAt = (index: number) => {
      if (blocks.length === 1) return;
      const prev = blocks[index - 1];
      const next = blocks[index + 1];
      setBlocks(
        produce((draft) => {
          draft.splice(index, 1);
        })
      );
      scheduleSave();
      const target = next ?? prev;
      if (target) focusBlock(target.id);
    };

    const moveFocus = (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction;
      const target = blocks[nextIndex];
      if (!target) return;
      focusBlock(target.id, direction === -1 ? "end" : "start");
    };

    const addReviewFromBlock = (block: Block) => {
      if (!block.id) return;
      void addReviewItem(block.id);
    };

    const handleKeyDown = (block: Block, index: number, event: KeyboardEvent) => {
      const target = event.currentTarget as HTMLTextAreaElement;
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd =
        target.selectionStart === target.value.length &&
        target.selectionEnd === target.value.length;

      if (event.key === "Enter") {
        event.preventDefault();
        recordLatency("insert");
        insertBlockAfter(index, block.indent);
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        recordLatency("indent");
        const delta = event.shiftKey ? -1 : 1;
        const nextIndent = Math.max(0, block.indent + delta);
        setBlocks(index, "indent", nextIndent);
        scheduleSave();
        return;
      }

      if (event.key === "Backspace" && block.text.length === 0) {
        event.preventDefault();
        recordLatency("delete");
        removeBlockAt(index);
        return;
      }

      if (event.key === "ArrowUp" && atStart) {
        event.preventDefault();
        moveFocus(index, -1);
        return;
      }

      if (event.key === "ArrowDown" && atEnd) {
        event.preventDefault();
        moveFocus(index, 1);
      }
    };

    const getCodePreview = (text: string) => {
      const renderer = renderersByKind().get("code");
      if (!renderer) return null;
      const fence = parseInlineFence(text);
      if (!fence || DIAGRAM_LANGS.has(fence.lang)) return null;
      return {
        renderer,
        ...fence
      };
    };

    const getDiagramPreview = (text: string) => {
      const renderer = renderersByKind().get("diagram");
      if (!renderer) return null;
      const fence = parseInlineFence(text);
      if (!fence || !DIAGRAM_LANGS.has(fence.lang)) return null;
      return {
        renderer,
        ...fence
      };
    };

    return (
      <section class="editor-pane">
        <div class="editor-pane__header">
          <div>
            <div class="editor-pane__title">{props.title}</div>
            <div class="editor-pane__meta">{props.meta}</div>
          </div>
          <div class="editor-pane__count">{blocks.length} blocks</div>
        </div>
        <div class="editor-pane__body" ref={editorRef}>
          <div class="virtual-space" style={{ height: `${range().totalHeight}px` }}>
            <div
              class="virtual-list"
              style={{ transform: `translateY(${range().offset}px)` }}
            >
              <For each={visibleBlocks()}>
                {(block, index) => {
                  const blockIndex = () => range().start + index();
                  const codePreview = () => getCodePreview(block.text);
                  const diagramPreview = () => getDiagramPreview(block.text);
                  return (
                    <div
                      class={`block ${activeId() === block.id ? "is-active" : ""}`}
                      style={{
                        "margin-left": `${block.indent * 24}px`,
                        "--i": `${blockIndex()}`
                      }}
                    >
                      <span class="block__bullet" aria-hidden="true" />
                      <div class="block__body">
                        <textarea
                          ref={(el) => inputRefs.set(block.id, el)}
                          class="block__input"
                          rows={1}
                          data-block-id={block.id}
                          value={block.text}
                          placeholder="Write something..."
                          spellcheck={true}
                          onFocus={() => setActiveId(block.id)}
                          onInput={(event) => {
                            recordLatency("input");
                            setBlocks(blockIndex(), "text", event.currentTarget.value);
                            scheduleSave();
                          }}
                          onKeyDown={(event) => handleKeyDown(block, blockIndex(), event)}
                        />
                        <Show when={activeId() === block.id}>
                          <div class="block__actions">
                            <button
                              class="block__action"
                              onClick={() => addReviewFromBlock(block)}
                            >
                              Add to review
                            </button>
                          </div>
                        </Show>
                        <Show when={codePreview()}>
                          {(preview) => (
                            <div class="block-renderer block-renderer--code">
                              <div class="block-renderer__title">Code preview</div>
                              <div class="block-renderer__meta">
                                {preview().renderer.title} · {preview().lang}
                              </div>
                              <pre class="block-renderer__content">
                                <code>{preview().content}</code>
                              </pre>
                            </div>
                          )}
                        </Show>
                        <Show when={diagramPreview()}>
                          {(preview) => (
                            <div class="block-renderer block-renderer--diagram">
                              <div class="block-renderer__title">Diagram preview</div>
                              <div class="block-renderer__meta">
                                {preview().renderer.title} · {preview().lang}
                              </div>
                              <div class="block-renderer__diagram">
                                <div class="diagram-node">A</div>
                                <div class="diagram-edge">→</div>
                                <div class="diagram-node">B</div>
                              </div>
                              <pre class="block-renderer__content">
                                <code>{preview().content}</code>
                              </pre>
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div class="app">
      {perfEnabled() && (
        <aside class="perf-hud">
          <div class="perf-hud__title">Perf</div>
          <div class="perf-hud__row">
            Input p50 <span>{perfStats().p50?.toFixed(1) ?? "--"}ms</span>
          </div>
          <div class="perf-hud__row">
            Input p95 <span>{perfStats().p95?.toFixed(1) ?? "--"}ms</span>
          </div>
          <div class="perf-hud__row">
            Scroll <span>{scrollFps()} fps</span>
          </div>
          <div class="perf-hud__row">
            Samples <span>{perfStats().count}</span>
          </div>
        </aside>
      )}

      <header class="topbar">
        <div class="topbar__left">
          <div class="topbar__title">Sandpaper</div>
          <div class="topbar__subtitle">Local-first outline lab</div>
          <div class="topbar__meta">
            Enter: new block · Tab: indent · Shift+Tab: outdent · Backspace: delete empty
          </div>
        </div>
        <div class="topbar__status">
          <span
            class={`topbar__autosave ${autosaved() ? "is-saved" : ""}`}
          >
            {autosaved()
              ? `Saved ${autosaveStamp() || "just now"}`
              : "Saving…"}
          </span>
        </div>
        <nav class="mode-switch">
          <button
            class={`mode-switch__button ${mode() === "quick-capture" ? "is-active" : ""}`}
            onClick={() => setMode("quick-capture")}
          >
            Quick Capture
          </button>
          <button
            class={`mode-switch__button ${mode() === "editor" ? "is-active" : ""}`}
            onClick={() => setMode("editor")}
          >
            Editor
          </button>
          <button
            class={`mode-switch__button ${mode() === "review" ? "is-active" : ""}`}
            onClick={() => setMode("review")}
          >
            Review
          </button>
        </nav>
      </header>

      <Show
        when={mode() === "editor"}
        fallback={
          <section class="focus-panel">
            <Show
              when={mode() === "quick-capture"}
              fallback={
                <ReviewPane />
              }
            >
              <div class="capture">
                <h2>Quick capture</h2>
                <p>Drop a thought and send it straight to your inbox.</p>
                <textarea
                  class="capture__input"
                  rows={4}
                  placeholder="Capture a thought, link, or task..."
                  value={captureText()}
                  onInput={(event) => setCaptureText(event.currentTarget.value)}
                />
                <div class="capture__actions">
                  <button class="capture__button" onClick={addCapture}>
                    Add to Inbox
                  </button>
                  <span class="capture__hint">Shift+Enter for newline</span>
                </div>
              </div>
            </Show>
          </section>
        }
      >
        <div class="workspace">
          <aside class="sidebar">
            <div>
              <div class="sidebar__title">Search</div>
              <div class="sidebar__subtitle">Find blocks instantly</div>
            </div>
            <input
              class="sidebar__input"
              type="search"
              placeholder="Search notes, tags, or IDs"
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
            />
            <div class="sidebar__filters">
              <button
                class={`chip ${searchFilter() === "all" ? "is-active" : ""}`}
                onClick={() => setSearchFilter("all")}
              >
                All
              </button>
              <button
                class={`chip ${searchFilter() === "links" ? "is-active" : ""}`}
                onClick={() => setSearchFilter("links")}
              >
                Links
              </button>
              <button
                class={`chip ${searchFilter() === "tasks" ? "is-active" : ""}`}
                onClick={() => setSearchFilter("tasks")}
              >
                Tasks
              </button>
              <button
                class={`chip ${searchFilter() === "pinned" ? "is-active" : ""}`}
                onClick={() => setSearchFilter("pinned")}
              >
                Pinned
              </button>
            </div>
            <div class="sidebar__results">
              <Show
                when={filteredSearchResults().length > 0}
                fallback={<div class="sidebar__empty">No results yet.</div>}
              >
                <For each={filteredSearchResults()}>
                  {(block) => (
                    <button
                      class="result"
                      onClick={() => {
                        setActiveId(block.id);
                        setJumpToId(block.id);
                      }}
                    >
                      <div class="result__text">{block.text || "Untitled"}</div>
                      <div class="result__meta">Block {block.id}</div>
                    </button>
                  )}
                </For>
              </Show>
            </div>
            <div class="sidebar__vaults">
              <div class="sidebar__section-title">Vault</div>
              <select
                class="vault-select"
                value={activeVault()?.id ?? ""}
                onChange={(event) => applyActiveVault(event.currentTarget.value)}
              >
                <For each={vaults()}>
                  {(vault) => <option value={vault.id}>{vault.name}</option>}
                </For>
              </select>
              <button
                class="vault-action"
                onClick={() => setVaultFormOpen((prev) => !prev)}
              >
                {vaultFormOpen() ? "Close" : "New vault"}
              </button>
              <Show when={vaultFormOpen()}>
                <div class="vault-form">
                  <input
                    class="vault-input"
                    type="text"
                    placeholder="Vault name"
                    value={newVaultName()}
                    onInput={(event) => setNewVaultName(event.currentTarget.value)}
                  />
                  <input
                    class="vault-input"
                    type="text"
                    placeholder="Vault path"
                    value={newVaultPath()}
                    onInput={(event) => setNewVaultPath(event.currentTarget.value)}
                  />
                  <div class="vault-actions">
                    <button class="vault-action is-primary" onClick={createVault}>
                      Create
                    </button>
                    <button
                      class="vault-action"
                      onClick={() => setVaultFormOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Show>
            </div>
            <div class="sidebar__vault-key">
              <div class="sidebar__section-title">Vault key</div>
              <div class="vault-key__status">
                <span>
                  {vaultKeyStatus().configured ? "Configured" : "Not set"}
                </span>
                <span>
                  {vaultKeyStatus().configured
                    ? `${vaultKeyStatus().kdf ?? "pbkdf2-sha256"} · ${
                        vaultKeyStatus().iterations ?? "--"
                      } iter`
                    : "Set a passphrase to enable E2E sync."}
                </span>
              </div>
              <input
                class="vault-input"
                type="password"
                placeholder="Passphrase"
                value={vaultPassphrase()}
                onInput={(event) => setVaultPassphrase(event.currentTarget.value)}
              />
              <div class="vault-actions">
                <button
                  class="vault-action is-primary"
                  disabled={vaultKeyBusy() || vaultPassphrase().trim().length === 0}
                  onClick={setVaultKey}
                >
                  {vaultKeyBusy() ? "Deriving..." : "Set passphrase"}
                </button>
                <button
                  class="vault-action"
                  onClick={() => setVaultPassphrase("")}
                >
                  Clear
                </button>
              </div>
              <Show when={vaultKeyMessage()}>
                <div class="vault-key__message">{vaultKeyMessage()}</div>
              </Show>
            </div>
            <div class="sidebar__sync">
              <div class="sidebar__section-title">Sync</div>
              <div class="sync-card">
                <div class="sync-card__header">
                  <div>
                    <div class="sync-card__title">Background sync</div>
                    <div class="sync-card__meta">{syncStateDetail()}</div>
                  </div>
                  <div
                    class={`sync-pill is-${syncStatus().state} ${
                      syncConnected() ? "is-connected" : "is-disconnected"
                    }`}
                  >
                    {syncStateLabel()}
                  </div>
                </div>
                <div class="sync-card__stats">
                  <div class="sync-stat">
                    <span>Queue</span>
                    <strong>{syncStatus().pending_ops}</strong>
                  </div>
                  <div class="sync-stat">
                    <span>Push</span>
                    <strong>{syncStatus().last_push_count}</strong>
                  </div>
                  <div class="sync-stat">
                    <span>Pull</span>
                    <strong>{syncStatus().last_pull_count}</strong>
                  </div>
                  <div class="sync-stat">
                    <span>Apply</span>
                    <strong>{syncStatus().last_apply_count}</strong>
                  </div>
                </div>
                <div class="sync-card__fields">
                  <input
                    class="vault-input"
                    type="text"
                    placeholder="Sync server URL"
                    value={syncServerUrl()}
                    onInput={(event) => setSyncServerUrl(event.currentTarget.value)}
                  />
                  <input
                    class="vault-input"
                    type="text"
                    placeholder="Vault ID (optional)"
                    value={syncVaultIdInput()}
                    onInput={(event) =>
                      setSyncVaultIdInput(event.currentTarget.value)
                    }
                  />
                  <input
                    class="vault-input"
                    type="text"
                    placeholder="Device ID (optional)"
                    value={syncDeviceIdInput()}
                    onInput={(event) =>
                      setSyncDeviceIdInput(event.currentTarget.value)
                    }
                  />
                </div>
                <div class="vault-actions">
                  <button
                    class="vault-action is-primary"
                    disabled={
                      !isTauri() ||
                      syncBusy() ||
                      !vaultKeyStatus().configured ||
                      syncServerUrl().trim().length === 0
                    }
                    onClick={connectSync}
                  >
                    {syncBusy() ? "Connecting..." : "Connect sync"}
                  </button>
                  <button
                    class="vault-action"
                    disabled={!isTauri() || syncBusy() || !syncConnected()}
                    onClick={syncNow}
                  >
                    Sync now
                  </button>
                </div>
                <Show when={syncMessage()}>
                  <div class="sync-card__message">{syncMessage()}</div>
                </Show>
                <Show when={syncConnected()}>
                  <div class="sync-card__ids">
                    <div class="sync-card__id">
                      <span>Vault</span>
                      <code>{syncConfig()?.vault_id}</code>
                    </div>
                    <div class="sync-card__id">
                      <span>Device</span>
                      <code>{syncConfig()?.device_id}</code>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
            <div class="sidebar__plugins">
              <div class="sidebar__section-title">Plugins</div>
              <Show
                when={plugins().length > 0}
                fallback={<div class="sidebar__empty">No plugins installed.</div>}
              >
                <For each={plugins()}>
                  {(plugin) => (
                    <div class={`plugin-card ${plugin.enabled ? "" : "is-disabled"}`}>
                      <div class="plugin-card__header">
                        <div>
                          <div class="plugin-card__name">{plugin.name}</div>
                          <div class="plugin-card__meta">
                            {plugin.version} ·{" "}
                            {plugin.enabled ? "Enabled" : "Disabled"}
                          </div>
                        </div>
                        <div
                          class={`plugin-card__badge ${
                            plugin.enabled ? "is-on" : "is-off"
                          }`}
                        >
                          {plugin.enabled ? "On" : "Off"}
                        </div>
                      </div>
                      <Show when={plugin.description}>
                        <div class="plugin-card__desc">{plugin.description}</div>
                      </Show>
                      <Show
                        when={plugin.missing_permissions.length > 0}
                        fallback={
                          <div class="plugin-card__status is-ok">
                            All permissions granted
                          </div>
                        }
                      >
                        <div class="plugin-card__status">Needs permission</div>
                        <div class="plugin-card__permissions">
                          <For each={plugin.missing_permissions}>
                            {(permission) => (
                              <span class="chip chip--warn">{permission}</span>
                            )}
                          </For>
                        </div>
                        <div class="plugin-card__actions">
                          <For each={plugin.missing_permissions}>
                            {(permission) => (
                              <button
                                class="plugin-action"
                                onClick={() =>
                                  requestGrantPermission(plugin, permission)
                                }
                              >
                                Grant {permission}
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
              <div class="plugin-card__actions">
                <button
                  class="plugin-action is-primary"
                  onClick={loadPluginRuntime}
                  disabled={pluginBusy()}
                >
                  {pluginBusy() ? "Loading plugins..." : "Load plugins"}
                </button>
              </div>
              <Show when={pluginStatus()}>
                <div class="plugin-status">
                  <span>{pluginStatus()?.loaded.length ?? 0} loaded</span>
                  <span>{pluginStatus()?.blocked.length ?? 0} blocked</span>
                  <span>{pluginStatus()?.commands.length ?? 0} commands</span>
                  <span>{pluginStatus()?.panels.length ?? 0} panels</span>
                  <span>
                    {pluginStatus()?.toolbar_actions.length ?? 0} toolbar actions
                  </span>
                  <span>{pluginStatus()?.renderers.length ?? 0} renderers</span>
                </div>
                <div class="plugin-surfaces">
                  <Show when={(pluginStatus()?.commands.length ?? 0) > 0}>
                    <div class="plugin-surface">
                      <div class="plugin-surface__title">Commands</div>
                      <div class="plugin-surface__list">
                        <For each={pluginStatus()?.commands ?? []}>
                          {(command) => (
                            <div class="plugin-surface__item">
                              <div>
                                <div class="plugin-surface__name">{command.title}</div>
                                <div class="plugin-surface__meta">{command.id}</div>
                              </div>
                              <button
                                class="plugin-surface__action"
                                onClick={() => runPluginCommand(command)}
                              >
                                Run command
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={(pluginStatus()?.panels.length ?? 0) > 0}>
                    <div class="plugin-surface">
                      <div class="plugin-surface__title">Panels</div>
                      <div class="plugin-surface__list">
                        <For each={pluginStatus()?.panels ?? []}>
                          {(panel) => (
                            <div class="plugin-surface__item">
                              <div>
                                <div class="plugin-surface__name">{panel.title}</div>
                                <div class="plugin-surface__meta">
                                  {panel.id}
                                  <Show when={panel.location}>
                                    {(location) => ` · ${location()}`}
                                  </Show>
                                </div>
                              </div>
                              <button
                                class="plugin-surface__action"
                                onClick={() => openPanel(panel)}
                              >
                                Open panel
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={(pluginStatus()?.toolbar_actions.length ?? 0) > 0}>
                    <div class="plugin-surface">
                      <div class="plugin-surface__title">Toolbar actions</div>
                      <div class="plugin-surface__list">
                        <For each={pluginStatus()?.toolbar_actions ?? []}>
                          {(action) => (
                            <div class="plugin-surface__item">
                              <div>
                                <div class="plugin-surface__name">{action.title}</div>
                                <div class="plugin-surface__meta">
                                  {action.id}
                                  <Show when={action.tooltip}>
                                    {(tooltip) => ` · ${tooltip()}`}
                                  </Show>
                                </div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={(pluginStatus()?.renderers.length ?? 0) > 0}>
                    <div class="plugin-surface">
                      <div class="plugin-surface__title">Renderers</div>
                      <div class="plugin-surface__list">
                        <For each={pluginStatus()?.renderers ?? []}>
                          {(renderer) => (
                            <div class="plugin-surface__item">
                              <div>
                                <div class="plugin-surface__name">{renderer.title}</div>
                                <div class="plugin-surface__meta">
                                  {renderer.id} · {renderer.kind}
                                </div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              <Show when={commandStatus()}>
                {(status) => (
                  <div class="plugin-command-status">{status()}</div>
                )}
              </Show>
            </Show>
              <div class="import-card">
                <div class="import-card__title">Markdown import</div>
                <div class="import-card__desc">
                  Paste shadow Markdown to append blocks into Inbox.
                </div>
                <textarea
                  class="import-card__input"
                  rows={4}
                  placeholder="Paste markdown to import"
                  value={importText()}
                  onInput={(event) => setImportText(event.currentTarget.value)}
                />
                <div class="import-card__actions">
                  <button
                    class="import-button"
                    onClick={importMarkdown}
                    disabled={importing()}
                  >
                    {importing() ? "Importing..." : "Import Markdown"}
                  </button>
                  <button
                    class="import-clear"
                    onClick={() => {
                      setImportText("");
                      setImportStatus(null);
                    }}
                    disabled={importing()}
                  >
                    Clear
                  </button>
                </div>
                <Show when={importStatus()}>
                  {(status) => (
                    <div class={`import-status import-status--${status().state}`}>
                      {status().message}
                    </div>
                  )}
                </Show>
              </div>
              <div class="export-card">
                <div class="export-card__title">Markdown export</div>
                <div class="export-card__desc">
                  Export every page as read-only Markdown with stable block IDs.
                </div>
                <button
                  class="export-button"
                  onClick={exportMarkdown}
                  disabled={exporting()}
                >
                  {exporting() ? "Exporting..." : "Export Markdown"}
                </button>
                <Show when={exportStatus()}>
                  {(status) => (
                    <div class={`export-status export-status--${status().state}`}>
                      {status().message}
                    </div>
                  )}
                </Show>
                <Show when={exportStatus()?.preview}>
                  {(preview) => (
                    <pre class="export-preview">
                      <code>{preview()}</code>
                    </pre>
                  )}
                </Show>
              </div>
            </div>
            <div class="sidebar__footer">
              <div>
                Active: {activeVault()?.name ?? "None"} ·{" "}
                {activeVault()?.path ?? "--"}
              </div>
              <div>{blocks.length} blocks indexed</div>
            </div>
          </aside>

          <div class="panes">
            <EditorPane title="Primary editor" meta={pageTitle()} />
            <EditorPane title="Connection pane" meta="Split view" />
          </div>
          <Show when={activeBlock()}>
            {(block) => (
              <section class="backlinks">
                <div class="backlinks__header">
                  <div>
                    <div class="backlinks__title">Backlinks</div>
                    <div class="backlinks__meta">
                      For block {block().id}
                    </div>
                  </div>
                  <div class="backlinks__count">
                    {activeBacklinks().length} linked
                  </div>
                </div>
                <Show
                  when={activeBacklinks().length > 0}
                  fallback={
                    <div class="backlinks__empty">
                      No backlinks yet. Use <span>((block-id))</span> to link.
                    </div>
                  }
                >
                  <div class="backlinks__list">
                    <For each={activeBacklinks()}>
                      {(entry) => (
                        <button
                          class="backlink"
                          onClick={() => {
                            setActiveId(entry.id);
                            setJumpToId(entry.id);
                          }}
                        >
                          <div class="backlink__text">{entry.text}</div>
                          <div class="backlink__meta">Block {entry.id}</div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )}
          </Show>
          <Show when={activePanel()}>
            {(panel) => (
              <section class="plugin-panel">
                <div class="plugin-panel__header">
                  <div>
                    <div class="plugin-panel__title">Active panel</div>
                    <div class="plugin-panel__meta">
                      {panel().title} · {panel().id}
                    </div>
                  </div>
                  <button
                    class="plugin-panel__close"
                    onClick={() => setActivePanel(null)}
                  >
                    Close
                  </button>
                </div>
                <div class="plugin-panel__body">
                  <div class="plugin-panel__content">
                    Sandboxed panel placeholder for {panel().plugin_id}.
                  </div>
                </div>
              </section>
            )}
          </Show>
        </div>
      </Show>

      <Show when={permissionPrompt()}>
        {(prompt) => (
          <div class="modal-backdrop" role="presentation">
            <div class="modal" role="dialog" aria-modal="true">
              <h3>Grant permission</h3>
              <p>
                Allow <strong>{prompt().pluginName}</strong> to use{" "}
                <strong>{prompt().permission}</strong>?
              </p>
              <div class="modal__actions">
                <button class="modal__button is-primary" onClick={grantPermission}>
                  Allow
                </button>
                <button class="modal__button" onClick={dismissPermissionPrompt}>
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

export default App;
