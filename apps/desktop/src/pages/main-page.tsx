import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type JSX
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  buildBacklinks,
  buildWikilinkBacklinks,
  createShadowWriter,
  parseMarkdownPage,
  serializePageToMarkdown
} from "@sandpaper/core-model";
import { deriveVaultKey } from "@sandpaper/crypto";
import type { Block, BlockPayload, BlockSearchResult } from "../entities/block/model/block-types";
import { makeBlock } from "../entities/block/model/make-block";
import { BacklinksPanel } from "../widgets/backlinks/backlinks-panel";
import { BacklinksToggle } from "../widgets/backlinks/backlinks-toggle";
import { CapturePane } from "../widgets/capture/capture-pane";
import { EditorPane } from "../widgets/editor/editor-pane";
import { UnlinkedReferencesPane } from "../widgets/discovery/unlinked-references-pane";
import { FocusPanel } from "../widgets/focus-panel/focus-panel";
import { PerfHud } from "../widgets/perf/perf-hud";
import { PluginPanelWidget } from "../widgets/plugins/plugin-panel";
import { ReviewPane } from "../widgets/review/review-pane";
import { SearchPane } from "../widgets/search/search-pane";
import { SettingsModal } from "../widgets/settings/settings-modal";
import { PagesPane } from "../widgets/sidebar/pages-pane";
import { SidebarPanel } from "../widgets/sidebar/sidebar-panel";
import { createSectionJump } from "../widgets/section-jump/section-jump";
import { Topbar } from "../widgets/topbar/topbar";
import { EditorWorkspace } from "../widgets/workspace/editor-workspace";
import { CommandPalette } from "../features/command-palette/ui/command-palette";
import type {
  BacklinkEntry,
  PageBacklinkRecord,
  PageLinkBlock,
  UnlinkedReference
} from "../entities/page/model/backlink-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../entities/page/model/page-types";
import type {
  PluginCommand,
  PluginPanel,
  PluginPermissionInfo,
  PluginRenderer,
  PluginRuntimeStatus,
  PermissionPrompt
} from "../entities/plugin/model/plugin-types";
import type {
  ReviewQueueItem,
  ReviewQueueSummary,
  ReviewTemplate
} from "../entities/review/model/review-types";
import type { SearchResult } from "../entities/search/model/search-types";
import type {
  SyncApplyResult,
  SyncConfig,
  SyncConflict,
  SyncLogEntry,
  SyncOpEnvelope,
  SyncServerPullResponse,
  SyncServerPushResponse,
  SyncStatus
} from "../entities/sync/model/sync-types";
import type { VaultConfig, VaultKeyStatus, VaultRecord } from "../entities/vault/model/vault-types";
import type { MarkdownExportStatus } from "../shared/model/markdown-export-types";
import {
  buildDefaultBlocks,
  buildEmptyBlocks,
  buildSeedBlocks,
  getSeedCount
} from "../shared/lib/blocks/block-seeds";
import { copyToClipboard } from "../shared/lib/clipboard/copy-to-clipboard";
import { makeLocalId, makeRandomId } from "../shared/lib/id/id-factory";
import { normalizePageUid } from "../shared/lib/page/normalize-page-uid";
import {
  createFpsMeter,
  createPerfTracker,
  type PerfStats
} from "../shared/lib/perf/perf";
import { replaceWikilinksInText } from "../shared/lib/links/replace-wikilinks";
import { escapeRegExp } from "../shared/lib/string/escape-regexp";

type Mode = "quick-capture" | "editor" | "review";

type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  action: () => void | Promise<void>;
};

type OfflineExportManifest = {
  version: number;
  exported_at: string;
  page_count: number;
  asset_count: number;
  vault_name?: string;
  pages: Array<{ uid: string; title: string; file: string }>;
};

const DEFAULT_PAGE_UID = "inbox";
const TYPE_SCALE_MIN = 0.8;
const TYPE_SCALE_MAX = 1.4;
const TYPE_SCALE_STEP = 0.05;
const TYPE_SCALE_DEFAULT = 1;
const TYPE_SCALE_DEFAULT_POSITION = `${(
  ((TYPE_SCALE_DEFAULT - TYPE_SCALE_MIN) /
    (TYPE_SCALE_MAX - TYPE_SCALE_MIN)) *
  100
).toFixed(2)}%`;

const buildLocalDefaults = () => buildDefaultBlocks(makeLocalId);
const defaultBlocks = buildLocalDefaults();
const resolveInitialBlocks = () => {
  const seedCount = getSeedCount();
  if (seedCount) {
    return buildSeedBlocks(makeLocalId, seedCount);
  }
  return defaultBlocks;
};

function MainPage() {
  const initialBlocks = resolveInitialBlocks();
  const initialBlockSnapshot = initialBlocks.map((block) => ({ ...block }));
  const [blocks, setBlocks] = createStore<Block[]>([
    ...initialBlocks
  ]);
  const [pages, setPages] = createSignal<PageSummary[]>([]);
  const [activePageUid, setActivePageUid] = createSignal(DEFAULT_PAGE_UID);
  const [localPages, setLocalPages] = createStore<
    Record<string, LocalPageRecord>
  >({
    [DEFAULT_PAGE_UID]: {
      uid: DEFAULT_PAGE_UID,
      title: "Inbox",
      blocks: initialBlockSnapshot
    }
  });
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [focusedId, setFocusedId] = createSignal<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = createSignal<string | null>(
    null
  );
  const [mode, setMode] = createSignal<Mode>("editor");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchFilter, setSearchFilter] = createSignal<
    "all" | "links" | "tasks" | "pinned"
  >("all");
  const [searchHistory, setSearchHistory] = createSignal<string[]>([]);
  const [newPageTitle, setNewPageTitle] = createSignal("");
  const [renameTitle, setRenameTitle] = createSignal("");
  const [pageMessage, setPageMessage] = createSignal<string | null>(null);
  const [pageBusy, setPageBusy] = createSignal(false);
  const [captureText, setCaptureText] = createSignal("");
  const [jumpTarget, setJumpTarget] = createSignal<{
    id: string;
    caret: "start" | "end" | "preserve";
  } | null>(null);
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
  const [syncLog, setSyncLog] = createSignal<SyncLogEntry[]>([]);
  const [syncConflicts, setSyncConflicts] = createSignal<SyncConflict[]>([]);
  const [syncConflictMergeId, setSyncConflictMergeId] = createSignal<string | null>(null);
  const [syncConflictMergeDrafts, setSyncConflictMergeDrafts] = createStore<
    Record<string, string>
  >({});
  const [pageTitle, setPageTitle] = createSignal("Inbox");
  const [plugins, setPlugins] = createSignal<PluginPermissionInfo[]>([]);
  const [pluginStatus, setPluginStatus] = createSignal<PluginRuntimeStatus | null>(
    null
  );
  const [pluginError, setPluginError] = createSignal<string | null>(null);
  const [permissionPrompt, setPermissionPrompt] =
    createSignal<PermissionPrompt | null>(null);
  const [autosaved, setAutosaved] = createSignal(false);
  const [autosaveStamp, setAutosaveStamp] = createSignal("");
  const [autosaveError, setAutosaveError] = createSignal<string | null>(null);
  const [shadowPendingCount, setShadowPendingCount] = createSignal(0);
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
  const [offlineExportStatus, setOfflineExportStatus] = createSignal<{
    state: "success" | "error";
    message: string;
  } | null>(null);
  const [offlineExporting, setOfflineExporting] = createSignal(false);
  const [offlineImportStatus, setOfflineImportStatus] = createSignal<{
    state: "success" | "error";
    message: string;
  } | null>(null);
  const [offlineImporting, setOfflineImporting] = createSignal(false);
  const [offlineImportFile, setOfflineImportFile] = createSignal<File | null>(
    null
  );
  const [activePanel, setActivePanel] = createSignal<PluginPanel | null>(null);
  const [commandStatus, setCommandStatus] = createSignal<string | null>(null);
  const [pluginBusy, setPluginBusy] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteQuery, setPaletteQuery] = createSignal("");
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  const [settingsTab, setSettingsTab] = createSignal<
    "general" | "vault" | "sync" | "plugins" | "permissions" | "import"
  >("general");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [backlinksOpen, setBacklinksOpen] = createSignal(false);
  const [typeScale, setTypeScale] = createSignal(TYPE_SCALE_DEFAULT);
  const [perfEnabled, setPerfEnabled] = createSignal(false);
  const [perfStats, setPerfStats] = createSignal<PerfStats>({
    count: 0,
    last: null,
    p50: null,
    p95: null
  });
  const [scrollFps, setScrollFps] = createSignal(0);
  let paletteInputRef: HTMLInputElement | undefined;

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
      granted_permissions: ["fs", "data.write", "ui", "clipboard"],
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

  const pageLinkBlocks = createMemo<PageLinkBlock[]>(() => {
    if (!isTauri()) {
      const currentUid = normalizePageUid(activePageUid() || DEFAULT_PAGE_UID);
      const currentTitle = pageTitle();
      const currentBlocks = blocks.map((block) => ({
        id: block.id,
        text: block.text,
        pageUid: currentUid,
        pageTitle: currentTitle
      }));
      const otherBlocks = Object.values(localPages).flatMap((page) => {
        if (page.uid === currentUid) return [];
        return page.blocks.map((block) => ({
          id: block.id,
          text: block.text,
          pageUid: page.uid,
          pageTitle: page.title
        }));
      });
      return [...currentBlocks, ...otherBlocks];
    }
    const activeUid = normalizePageUid(activePageUid() || DEFAULT_PAGE_UID);
    const activeTitle = pageTitle();
    return blocks.map((block) => ({
      id: block.id,
      text: block.text,
      pageUid: activeUid,
      pageTitle: activeTitle
    }));
  });

  const pageLinkBlocksById = createMemo(() => {
    const map = new Map<string, PageLinkBlock>();
    pageLinkBlocks().forEach((block) => {
      map.set(block.id, block);
    });
    return map;
  });

  const pageBacklinksMap = createMemo(() =>
    buildWikilinkBacklinks(pageLinkBlocks(), normalizePageUid)
  );

  const [remotePageBacklinks] = createResource(
    activePageUid,
    async (pageUid) => {
      if (!isTauri()) return [];
      const resolved = normalizePageUid(pageUid || DEFAULT_PAGE_UID);
      try {
        return (await invoke("list_page_wikilink_backlinks", {
          pageUid: resolved,
          page_uid: resolved
        })) as PageBacklinkRecord[];
      } catch (error) {
        console.error("Failed to load page backlinks", error);
        return [];
      }
    },
    { initialValue: [] }
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

  const activePageBacklinks = createMemo<BacklinkEntry[]>(() => {
    if (isTauri()) {
      return remotePageBacklinks().map((entry) => ({
        id: entry.block_uid,
        text: entry.text || "Untitled",
        pageUid: entry.page_uid,
        pageTitle: entry.page_title
      }));
    }
    const pageUid = normalizePageUid(activePageUid() || DEFAULT_PAGE_UID);
    const linked = pageBacklinksMap()[pageUid] ?? [];
    const lookup = pageLinkBlocksById();
    return linked
      .map((id) => lookup.get(id))
      .filter((block): block is PageLinkBlock => Boolean(block))
      .map((block) => ({
        id: block.id,
        text: block.text || "Untitled",
        pageUid: block.pageUid,
        pageTitle: block.pageTitle
      }));
  });

  const totalBacklinks = createMemo(
    () => activeBacklinks().length + activePageBacklinks().length
  );

  const getPageBacklinkSource = (entry: BacklinkEntry) => {
    const currentUid = normalizePageUid(activePageUid() || DEFAULT_PAGE_UID);
    const sourceUid = normalizePageUid(entry.pageUid || currentUid);
    if (sourceUid === currentUid) return "This page";
    return entry.pageTitle || "Untitled page";
  };

  const formatBacklinkSnippet = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "Untitled";
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 80)}...`;
  };

  const groupedPageBacklinks = createMemo(() => {
    const groups = new Map<
      string,
      { title: string; entries: BacklinkEntry[] }
    >();
    activePageBacklinks().forEach((entry) => {
      const key = normalizePageUid(entry.pageUid || entry.pageTitle || "page");
      const title = getPageBacklinkSource(entry);
      if (!groups.has(key)) {
        groups.set(key, { title, entries: [] });
      }
      groups.get(key)?.entries.push(entry);
    });
    return Array.from(groups.values()).sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  });

  const openPageBacklink = async (entry: BacklinkEntry) => {
    const targetPage = entry.pageUid ?? activePageUid();
    if (!targetPage) return;
    const currentUid = normalizePageUid(activePageUid() || DEFAULT_PAGE_UID);
    const targetUid = normalizePageUid(targetPage);
    if (targetUid !== currentUid) {
      await switchPage(targetPage);
    }
    setActiveId(entry.id);
    setJumpTarget({ id: entry.id, caret: "start" });
  };

  const supportsMultiPane = false;

  const openPageBacklinkInPane = async (entry: BacklinkEntry) => {
    if (!supportsMultiPane) return;
    await openPageBacklink(entry);
  };

  const filteredSearchResults = createMemo<SearchResult[]>(() => {
    const results = searchResults();
    if (searchFilter() === "all") return results;
    if (searchFilter() === "links") {
      return results.filter(
        (result) => result.text.includes("((") || result.text.includes("[[")
      );
    }
    if (searchFilter() === "tasks") {
      return results.filter((result) => /\[\s?[xX ]\s?\]/.test(result.text));
    }
    if (searchFilter() === "pinned") {
      return results.filter((result) => result.text.toLowerCase().includes("#pin"));
    }
    return results;
  });

  const commitSearchTerm = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((item) => item.toLowerCase() !== normalized)];
      return next.slice(0, 5);
    });
  };

  const applySearchTerm = (term: string) => {
    setSearchQuery(term);
    searchInputRef?.focus();
  };

  const renderSearchHighlight = (text: string): Array<string | JSX.Element> | string => {
    const query = searchQuery().trim();
    if (!query) return text;
    const escaped = escapeRegExp(query);
    if (!escaped) return text;
    const regex = new RegExp(escaped, "gi");
    const nodes: Array<string | JSX.Element> = [];
    let lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        nodes.push(text.slice(lastIndex, index));
      }
      nodes.push(<mark class="search-highlight">{match[0]}</mark>);
      lastIndex = index + match[0].length;
    }
    if (nodes.length === 0) return text;
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }
    return nodes;
  };

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
    },
    onPendingChange: (count) => setShadowPendingCount(count)
  });

  const resolvePageUid = (value: string) =>
    normalizePageUid(value || DEFAULT_PAGE_UID);

  const stripWikilinks = (text: string) => text.replace(/\[\[[^\]]+?\]\]/g, "");

  const unlinkedReferences = createMemo<UnlinkedReference[]>(() => {
    const currentUid = resolvePageUid(activePageUid());
    const availablePages = pages().filter(
      (page) =>
        page.title &&
        resolvePageUid(page.uid) !== currentUid &&
        page.title.trim().length > 0
    );
    if (availablePages.length === 0) return [];
    const refs: UnlinkedReference[] = [];
    const seen = new Set<string>();
    blocks.forEach((block, index) => {
      const source = stripWikilinks(block.text);
      if (!source.trim()) return;
      availablePages.forEach((page) => {
        const title = page.title?.trim();
        if (!title) return;
        const key = `${block.id}:${page.uid}`;
        if (seen.has(key)) return;
        const pattern = new RegExp(escapeRegExp(title), "i");
        if (pattern.test(source)) {
          seen.add(key);
          refs.push({
            pageTitle: title,
            pageUid: page.uid,
            blockId: block.id,
            blockIndex: index,
            snippet: formatBacklinkSnippet(source)
          });
        }
      });
    });
    return refs.slice(0, 12);
  });

  const linkUnlinkedReference = (ref: UnlinkedReference) => {
    const block = blocks[ref.blockIndex];
    if (!block || block.id !== ref.blockId) return;
    const pattern = new RegExp(escapeRegExp(ref.pageTitle), "i");
    const nextText = block.text.replace(pattern, `[[${ref.pageTitle}]]`);
    if (nextText === block.text) return;
    setBlocks(ref.blockIndex, "text", nextText);
    scheduleSave();
    setActiveId(ref.blockId);
    setJumpTarget({ id: ref.blockId, caret: "end" });
  };

  const snapshotBlocks = (source: Block[]) =>
    source.map((block) => ({ ...block }));

  const saveLocalPageSnapshot = (pageUid: string, title: string, items: Block[]) => {
    setLocalPages(resolvePageUid(pageUid), {
      uid: resolvePageUid(pageUid),
      title,
      blocks: snapshotBlocks(items)
    });
  };

  const loadPages = async () => {
    if (!isTauri()) {
      const entries = Object.values(localPages)
        .map((page) => ({ uid: page.uid, title: page.title }))
        .sort((left, right) => left.title.localeCompare(right.title));
      setPages(entries);
      if (
        entries.length > 0 &&
        !entries.find((page) => page.uid === resolvePageUid(activePageUid()))
      ) {
        setActivePageUid(entries[0]?.uid ?? DEFAULT_PAGE_UID);
      }
      return;
    }

    try {
      const remote = (await invoke("list_pages")) as PageSummary[];
      setPages(remote);
      if (
        remote.length > 0 &&
        !remote.find((page) => page.uid === resolvePageUid(activePageUid()))
      ) {
        setActivePageUid(remote[0]?.uid ?? DEFAULT_PAGE_UID);
      }
    } catch (error) {
      console.error("Failed to load pages", error);
    }
  };

  const loadActivePage = async () => {
    const vaultId = activeVault()?.id;
    if (!vaultId) return;
    if (!isTauri()) {
      const stored = localStorage.getItem(`sandpaper:active-page:${vaultId}`);
      if (stored) {
        setActivePageUid(resolvePageUid(stored));
      }
      return;
    }
    try {
      const stored = (await invoke("get_active_page")) as string | null;
      if (stored) {
        setActivePageUid(resolvePageUid(stored));
      }
    } catch (error) {
      console.error("Failed to load active page", error);
    }
  };

  const searchHistoryKey = createMemo(() => {
    const vaultId = activeVault()?.id ?? "default";
    return `sandpaper:search-history:${vaultId}`;
  });

  createEffect(() => {
    const key = searchHistoryKey();
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(key);
    if (!stored) {
      setSearchHistory([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      setSearchHistory(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSearchHistory([]);
    }
  });

  createEffect(() => {
    const key = searchHistoryKey();
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(searchHistory()));
  });

  const persistActivePage = async (pageUid: string) => {
    const resolved = resolvePageUid(pageUid);
    setActivePageUid(resolved);
    const vaultId = activeVault()?.id;
    if (!vaultId) return;
    if (!isTauri()) {
      localStorage.setItem(`sandpaper:active-page:${vaultId}`, resolved);
      return;
    }
    try {
      await invoke("set_active_page", {
        pageUid: resolved,
        page_uid: resolved
      });
    } catch (error) {
      console.error("Failed to persist active page", error);
    }
  };

  const switchPage = async (pageUid: string) => {
    const nextUid = resolvePageUid(pageUid);
    if (nextUid === resolvePageUid(activePageUid())) return;

    if (!isTauri()) {
      saveLocalPageSnapshot(activePageUid(), pageTitle(), blocks);
    }

    await persistActivePage(nextUid);
    await loadBlocks(nextUid);
  };

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
    const pageUid = resolvePageUid(activePageUid());
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
        payload: {
          id: item.id,
          action
        }
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
        payload: {
          page_uid: pageUid,
          template: template.id,
          title: `${template.title} · ${today}`
        }
      });
      setReviewMessage(`${template.title} template queued for review.`);
      await loadPages();
      await loadReviewSummary();
      await loadReviewQueue();
    } catch (error) {
      console.error("Failed to create review template", error);
      setReviewMessage("Unable to create review template.");
    } finally {
      setReviewBusy(false);
    }
  };

  let saveTimeout: number | undefined;
  let highlightTimeout: number | undefined;
  let saveRequestId = 0;
  let pendingSavePageUid: string | null = null;
  const markSaved = () => {
    setAutosaveError(null);
    setAutosaveStamp(stampNow());
    setAutosaved(true);
  };
  const markSaving = () => {
    setAutosaveError(null);
    setAutosaved(false);
  };
  const markSaveFailed = () => {
    setAutosaveError("Save failed");
    setAutosaved(false);
  };
  const persistBlocks = async (
    pageUid: string,
    payload: BlockPayload[],
    title: string,
    snapshot: Block[]
  ): Promise<boolean> => {
    if (!isTauri()) {
      saveLocalPageSnapshot(pageUid, title, snapshot);
      return true;
    }
    try {
      await invoke("save_page_blocks", {
        pageUid,
        page_uid: pageUid,
        blocks: payload
      });
      return true;
    } catch (error) {
      console.error("Failed to save blocks", error);
      return false;
    }
  };

  const scheduleShadowWrite = (pageUid = activePageUid()) => {
    if (!isTauri()) return;
    const resolvedUid = resolvePageUid(pageUid);
    const snapshot = untrack(() =>
      blocks.map((block) => ({
        id: block.id,
        text: block.text,
        indent: block.indent
      }))
    );
    const title = untrack(() => pageTitle());
    const content = serializePageToMarkdown({
      id: resolvedUid,
      title,
      blocks: snapshot
    });
    shadowWriter.scheduleWrite(resolvedUid, content);
  };

  const scheduleSave = () => {
    const pageUid = resolvePageUid(activePageUid());
    pendingSavePageUid = pageUid;
    const snapshot = untrack(() => snapshotBlocks(blocks));
    const payload = snapshot.map((block) => toPayload(block));
    const title = untrack(() => pageTitle());
    saveRequestId += 1;
    const requestId = saveRequestId;
    if (saveTimeout) {
      window.clearTimeout(saveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
      void (async () => {
        const success = await persistBlocks(pageUid, payload, title, snapshot);
        if (requestId !== saveRequestId) return;
        pendingSavePageUid = null;
        if (success) {
          markSaved();
        } else {
          markSaveFailed();
        }
      })();
    }, 400);
    scheduleShadowWrite(pageUid);
    markSaving();
  };

  const cancelPendingSave = (pageUid: string) => {
    if (pendingSavePageUid !== pageUid) return;
    if (saveTimeout) {
      window.clearTimeout(saveTimeout);
      saveTimeout = undefined;
    }
    saveRequestId += 1;
    pendingSavePageUid = null;
  };

  const stampNow = () =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());

  const syncStampNow = () =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date());

  const appendSyncLog = (
    entry: Omit<SyncLogEntry, "id" | "at"> & { at?: string }
  ) => {
    setSyncLog((prev) => {
      const next = [
        ...prev,
        {
          id: makeRandomId(),
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
    await copyToClipboard(lines.join("\n"));
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

  const fetchPageBlocks = async (pageUid: string): Promise<LocalPageRecord | null> => {
    const resolvedUid = resolvePageUid(pageUid);
    if (!isTauri()) {
      const local = localPages[resolvedUid];
      if (!local) return null;
      return {
        uid: resolvedUid,
        title: local.title,
        blocks: snapshotBlocks(local.blocks)
      };
    }
    try {
      const response = (await invoke("load_page_blocks", {
        pageUid: resolvedUid,
        page_uid: resolvedUid
      })) as PageBlocksResponse;
      return {
        uid: resolvedUid,
        title:
          response.title ||
          (resolvedUid === DEFAULT_PAGE_UID ? "Inbox" : "Untitled"),
        blocks: response.blocks.map((block) =>
          makeBlock(block.uid, block.text, block.indent)
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
    const resolvedUid = resolvePageUid(conflict.page_uid);
    const resolvedText =
      resolution === "merge"
        ? mergeText ?? ""
        : resolution === "local"
          ? conflict.local_text
          : conflict.remote_text;

    const updateBlocks = (items: Block[]) => {
      const index = items.findIndex((block) => block.id === conflict.block_uid);
      if (index < 0) return null;
      const next = snapshotBlocks(items);
      next[index] = {
        ...next[index],
        text: resolvedText
      };
      return next;
    };

    const saveBlocks = async (items: Block[], title: string) => {
      const next = updateBlocks(items);
      if (!next) return false;
      if (resolvedUid === resolvePageUid(activePageUid())) {
        setBlocks(next);
      } else if (!isTauri()) {
        saveLocalPageSnapshot(resolvedUid, title, next);
      }
      markSaving();
      const payload = next.map((block) => toPayload(block));
      const success = await persistBlocks(resolvedUid, payload, title, next);
      if (success) {
        markSaved();
        if (resolvedUid === resolvePageUid(activePageUid())) {
          scheduleShadowWrite(resolvedUid);
        }
      } else {
        markSaveFailed();
      }
      return success;
    };

    if (resolvedUid === resolvePageUid(activePageUid())) {
      await saveBlocks(snapshotBlocks(blocks), pageTitle());
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

  const getConflictPageTitle = (pageUid: string) =>
    pages().find((page) => page.uid === resolvePageUid(pageUid))?.title ??
    pageUid;

  const loadBlocks = async (pageUid = activePageUid()) => {
    const resolvedUid = resolvePageUid(pageUid);
    setActivePageUid(resolvedUid);
    setFocusedId(null);

    if (!isTauri()) {
      const local = localPages[resolvedUid];
      if (!local) {
        const seeded =
          resolvedUid === DEFAULT_PAGE_UID
            ? buildLocalDefaults()
            : buildEmptyBlocks(makeLocalId);
        const title = resolvedUid === DEFAULT_PAGE_UID ? "Inbox" : "Untitled";
        saveLocalPageSnapshot(resolvedUid, title, seeded);
        setBlocks(seeded);
        setPageTitle(title);
        setRenameTitle(title);
        setActiveId(seeded[0]?.id ?? null);
        markSaved();
        await loadPages();
        return;
      }
      setBlocks(snapshotBlocks(local.blocks));
      const localTitle = local.title || "Untitled";
      setPageTitle(localTitle);
      setRenameTitle(localTitle);
      setActiveId(local.blocks[0]?.id ?? null);
      markSaved();
      return;
    }

    try {
      const response = (await invoke("load_page_blocks", {
        pageUid: resolvedUid,
        page_uid: resolvedUid
      })) as PageBlocksResponse;
      const loaded = response.blocks.map((block) =>
        makeBlock(block.uid, block.text, block.indent)
      );
      const title = response.title || (resolvedUid === DEFAULT_PAGE_UID ? "Inbox" : "Untitled");
      setPageTitle(title);
      setRenameTitle(title);
      if (loaded.length === 0) {
        const seeded = buildDefaultBlocks(makeRandomId);
        setBlocks(seeded);
        await invoke("save_page_blocks", {
          pageUid: resolvedUid,
          page_uid: resolvedUid,
          blocks: seeded.map((block) => toPayload(block))
        });
        const seedMarkdown = serializePageToMarkdown({
          id: resolvedUid,
          title,
          blocks: seeded.map((block) => ({
            id: block.id,
            text: block.text,
            indent: block.indent
          }))
        });
        shadowWriter.scheduleWrite(resolvedUid, seedMarkdown);
        setActiveId(seeded[0]?.id ?? null);
        markSaved();
        return;
      }
      setBlocks(loaded);
      setActiveId(loaded[0]?.id ?? null);
      const loadedMarkdown = serializePageToMarkdown({
        id: resolvedUid,
        title,
        blocks: loaded.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
      shadowWriter.scheduleWrite(resolvedUid, loadedMarkdown);
      markSaved();
    } catch (error) {
      console.error("Failed to load blocks", error);
      setBlocks(buildLocalDefaults());
      setPageTitle("Inbox");
      setRenameTitle("Inbox");
      markSaved();
    }
  };

  const loadPlugins = async () => {
    if (!isTauri()) {
      setPlugins(fallbackPlugins);
      setPluginStatus(fallbackPluginStatus);
      return;
    }

    setPluginError(null);
    try {
      const remote = (await invoke("list_plugins_command")) as PluginPermissionInfo[];
      setPlugins(remote);
    } catch (error) {
      console.error("Failed to load plugins", error);
      setPluginError(
        error instanceof Error ? error.message : "Failed to load plugins."
      );
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
    if (!isTauri()) return { pages: [], applied: 0, conflicts: [] };
    const result = (await invoke("apply_sync_inbox")) as SyncApplyResult;
    const conflicts = result.conflicts ?? [];
    if (conflicts.length > 0) {
      mergeSyncConflicts(conflicts);
    }
    if (
      result.applied > 0 &&
      result.pages.includes(resolvePageUid(activePageUid()))
    ) {
      await loadBlocks(activePageUid());
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
    if (!syncConfig()) {
      await loadSyncConfig();
    }
    await runSyncCycle(true);
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
    markSaved();
  };

  const dismissPermissionPrompt = () => {
    setPermissionPrompt(null);
  };

  const loadPluginRuntime = async () => {
    if (!isTauri()) {
      setPluginStatus(fallbackPluginStatus);
      return;
    }
    setPluginError(null);
    setPluginBusy(true);
    try {
      const status = (await invoke("load_plugins_command")) as PluginRuntimeStatus;
      setPluginStatus(status);
    } catch (error) {
      console.error("Failed to load plugins", error);
      setPluginError(
        error instanceof Error ? error.message : "Plugin runtime failed."
      );
    } finally {
      setPluginBusy(false);
    }
  };

  const resolveUniqueLocalPageUid = (title: string) => {
    const base = resolvePageUid(title);
    let candidate = base;
    let counter = 2;
    while (localPages[candidate]) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return candidate;
  };

  const formatDailyNoteTitle = () =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

  const ensureDailyNote = async () => {
    const title = formatDailyNoteTitle();
    const dailyUid = resolvePageUid(title);
    if (!dailyUid) return;

    const exists = pages().some((page) => {
      const pageUid = resolvePageUid(page.uid);
      const titleUid = resolvePageUid(page.title || "");
      return pageUid === dailyUid || titleUid === dailyUid;
    });
    if (exists) return;

    try {
      if (isTauri()) {
        await invoke("create_page", {
          payload: { title }
        });
      } else {
        const uid = resolveUniqueLocalPageUid(title);
        const seeded = buildEmptyBlocks(makeLocalId);
        saveLocalPageSnapshot(uid, title, seeded);
      }
      await loadPages();
    } catch (error) {
      console.error("Failed to auto-create daily note", error);
    }
  };

  const createPage = async () => {
    const title = newPageTitle().trim();
    if (!title) {
      setPageMessage("Enter a page title first.");
      return;
    }
    setPageBusy(true);
    setPageMessage(null);
    try {
      let created: PageSummary;
      if (isTauri()) {
        created = (await invoke("create_page", {
          payload: { title }
        })) as PageSummary;
        await loadPages();
      } else {
        const uid = resolveUniqueLocalPageUid(title);
        const seeded = buildEmptyBlocks(makeLocalId);
        saveLocalPageSnapshot(uid, title, seeded);
        created = { uid, title };
        await loadPages();
      }
      await persistActivePage(created.uid);
      await loadBlocks(created.uid);
      setNewPageTitle("");
      setRenameTitle(created.title);
    } catch (error) {
      console.error("Failed to create page", error);
      setPageMessage("Failed to create page.");
    } finally {
      setPageBusy(false);
    }
  };

  const createPageFromLink = async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return null;
    setPageMessage(null);
    try {
      let created: PageSummary;
      if (isTauri()) {
        created = (await invoke("create_page", {
          payload: { title: trimmed }
        })) as PageSummary;
        await loadPages();
      } else {
        const uid = resolveUniqueLocalPageUid(trimmed);
        const seeded = buildEmptyBlocks(makeLocalId);
        saveLocalPageSnapshot(uid, trimmed, seeded);
        created = { uid, title: trimmed };
        await loadPages();
      }
      return created;
    } catch (error) {
      console.error("Failed to create page from link", error);
      setPageMessage("Failed to create page.");
      return null;
    }
  };

  const updateWikilinksAcrossPages = async (
    fromTitle: string,
    toTitle: string
  ) => {
    const normalizedFrom = normalizePageUid(fromTitle);
    const normalizedTo = normalizePageUid(toTitle);
    if (!normalizedFrom || normalizedFrom === normalizedTo) return;

    const updateBlocks = <T extends { text: string }>(source: T[]) => {
      let changed = false;
      const updated = source.map((block) => {
        const nextText = replaceWikilinksInText(block.text, fromTitle, toTitle);
        if (nextText === block.text) return block;
        changed = true;
        return { ...block, text: nextText };
      });
      return { updated, changed };
    };

    if (!isTauri()) {
      const currentUid = resolvePageUid(activePageUid());
      Object.values(localPages).forEach((page) => {
        const { updated, changed } = updateBlocks(page.blocks);
        if (!changed) return;
        setLocalPages(page.uid, "blocks", updated);
        cancelPendingSave(resolvePageUid(page.uid));
        if (page.uid === currentUid) {
          setBlocks(updated as Block[]);
        }
      });
      return;
    }

    const pageList = pages().length
      ? pages()
      : ((await invoke("list_pages")) as PageSummary[]);
    for (const page of pageList) {
      const pageUid = resolvePageUid(page.uid);
      if (pageUid === resolvePageUid(activePageUid())) {
        const { updated, changed } = updateBlocks(blocks);
        if (changed) {
          setBlocks(updated as Block[]);
          await invoke("save_page_blocks", {
            pageUid,
            page_uid: pageUid,
            blocks: updated.map((block) => toPayload(block as Block))
          });
        }
        continue;
      }
      const response = (await invoke("load_page_blocks", {
        pageUid,
        page_uid: pageUid
      })) as PageBlocksResponse;
      const { updated, changed } = updateBlocks(response.blocks);
      if (!changed) continue;
      await invoke("save_page_blocks", {
        pageUid,
        page_uid: pageUid,
        blocks: updated
      });
    }
  };

  const renamePage = async () => {
    const title = renameTitle().trim();
    if (!title) {
      setPageMessage("Enter a page title first.");
      return;
    }
    setPageBusy(true);
    setPageMessage(null);
    const pageUid = resolvePageUid(activePageUid());
    const previousTitle = pageTitle();
    try {
      if (isTauri()) {
        const updated = (await invoke("rename_page", {
          payload: {
            page_uid: pageUid,
            title
          }
        })) as PageSummary;
        setPageTitle(updated.title);
        await loadPages();
      } else {
        if (localPages[pageUid]) {
          setLocalPages(pageUid, "title", title);
          setPageTitle(title);
        }
        await loadPages();
      }
      setRenameTitle(title);
      await updateWikilinksAcrossPages(previousTitle, title);
    } catch (error) {
      console.error("Failed to rename page", error);
      setPageMessage("Failed to rename page.");
    } finally {
      setPageBusy(false);
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

      const targetUid = parsed.hasHeader
        ? resolvePageUid(parsed.page.id)
        : resolvePageUid(activePageUid());
      const targetTitle =
        parsed.hasHeader && parsed.page.title.trim()
          ? parsed.page.title.trim()
          : pageTitle();
      const replacePage = parsed.hasHeader;
      const baseBlocks = replacePage ? [] : blocks;
      const existingIds = new Set(baseBlocks.map((block) => block.id));
      const importedBlocks = parsed.page.blocks.map((block) => {
        let nextId = block.id;
        if (existingIds.has(nextId)) {
          nextId = makeRandomId();
        }
        existingIds.add(nextId);
        return { ...block, id: nextId };
      });

      const nextBlocks = replacePage
        ? importedBlocks
        : [...baseBlocks, ...importedBlocks];
      setBlocks(nextBlocks);
      await persistActivePage(targetUid);
      if (importedBlocks[0]) {
        setActiveId(importedBlocks[0].id);
        setJumpTarget({ id: importedBlocks[0].id, caret: "start" });
      }
      if (targetTitle !== pageTitle()) {
        setPageTitle(targetTitle);
      }

      if (isTauri()) {
        if (targetTitle.trim()) {
          await invoke("set_page_title", {
            payload: {
              page_uid: targetUid,
              title: targetTitle.trim()
            }
          });
        }
        await invoke("save_page_blocks", {
          pageUid: targetUid,
          page_uid: targetUid,
          blocks: nextBlocks.map((block) => toPayload(block))
        });
        await loadPages();
      } else {
        saveLocalPageSnapshot(targetUid, targetTitle, nextBlocks);
        await loadPages();
      }

      const warningSuffix =
        parsed.warnings.length > 0
          ? ` ${parsed.warnings.length} warnings.`
          : "";
      const scopeLabel = replacePage ? targetTitle : pageTitle();
      setImportStatus({
        state: "success",
        message: `Imported ${importedBlocks.length} blocks into ${scopeLabel}.${warningSuffix}`
      });
      markSaved();
      shadowWriter.scheduleWrite(
        targetUid,
        serializePageToMarkdown({
          id: targetUid,
          title: targetTitle,
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
      const pageUid = resolvePageUid(activePageUid());
      const markdown = serializePageToMarkdown({
        id: pageUid,
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

  const collectOfflineExportPages = async (): Promise<LocalPageRecord[]> => {
    const result = new Map<string, LocalPageRecord>();
    const upsert = (page: LocalPageRecord) => {
      const uid = resolvePageUid(page.uid);
      if (!result.has(uid)) {
        result.set(uid, {
          uid,
          title: page.title,
          blocks: snapshotBlocks(page.blocks)
        });
      }
    };

    const activeUid = resolvePageUid(activePageUid() || DEFAULT_PAGE_UID);
    if (activeUid) {
      upsert({
        uid: activeUid,
        title: pageTitle() || activeUid,
        blocks: snapshotBlocks(blocks)
      });
    }

    Object.values(localPages).forEach((page) => upsert(page));
    const summaries =
      pages().length > 0
        ? pages()
        : Object.values(localPages).map((page) => ({
            uid: page.uid,
            title: page.title
          }));

    for (const summary of summaries) {
      const uid = resolvePageUid(summary.uid);
      if (result.has(uid)) continue;
      if (!isTauri()) continue;
      try {
        const response = (await invoke("load_page_blocks", {
          pageUid: uid,
          page_uid: uid
        })) as PageBlocksResponse;
        upsert({
          uid,
          title: summary.title || uid,
          blocks: response.blocks.map((block) =>
            makeBlock(block.uid, block.text, block.indent)
          )
        });
      } catch (error) {
        console.error("Failed to load page for export", error);
      }
    }

    return Array.from(result.values());
  };

  const buildOfflineArchive = async () => {
    const pagesToExport = await collectOfflineExportPages();
    if (pagesToExport.length === 0) {
      throw new Error("no-pages");
    }
    const exportedAt = new Date().toISOString();
    const manifest: OfflineExportManifest = {
      version: 1,
      exported_at: exportedAt,
      page_count: pagesToExport.length,
      asset_count: 0,
      vault_name: activeVault()?.name ?? "Default",
      pages: pagesToExport.map((page) => ({
        uid: resolvePageUid(page.uid),
        title: page.title,
        file: `pages/${resolvePageUid(page.uid)}.md`
      }))
    };

    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "assets/README.txt": strToU8("Drop assets here when exporting attachments.")
    };

    pagesToExport.forEach((page) => {
      const uid = resolvePageUid(page.uid);
      const markdown = serializePageToMarkdown({
        id: uid,
        title: page.title,
        blocks: page.blocks.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
      files[`pages/${uid}.md`] = strToU8(markdown);
    });

    return zipSync(files, { level: 6 });
  };

  const exportOfflineArchive = async () => {
    if (offlineExporting()) return;
    setOfflineExporting(true);
    setOfflineExportStatus(null);

    try {
      const archive = await buildOfflineArchive();
      const dateStamp = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
      const blob = new Blob([archive], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sandpaper-offline-${dateStamp}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setOfflineExportStatus({
        state: "success",
        message: "Offline export ready."
      });
    } catch (error) {
      console.error("Offline export failed", error);
      setOfflineExportStatus({
        state: "error",
        message: "Offline export failed. Check the logs for details."
      });
    } finally {
      setOfflineExporting(false);
    }
  };

  const readBinaryFile = async (file: File) => {
    if (typeof file.arrayBuffer === "function") {
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    }
    if (typeof FileReader !== "undefined") {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
      return new Uint8Array(buffer);
    }
    if (typeof file.text === "function") {
      const text = await file.text();
      return new TextEncoder().encode(text);
    }
    return new Uint8Array();
  };

  const importOfflineArchive = async () => {
    if (offlineImporting()) return;
    const file = offlineImportFile();
    if (!file) {
      setOfflineImportStatus({
        state: "error",
        message: "Choose a zip archive before importing."
      });
      return;
    }
    setOfflineImporting(true);
    setOfflineImportStatus(null);

    try {
      const bytes = await readBinaryFile(file);
      const entries = unzipSync(bytes);
      const manifestEntry = entries["manifest.json"];
      const manifest = manifestEntry
        ? (JSON.parse(strFromU8(manifestEntry)) as OfflineExportManifest)
        : null;
      const pageFiles =
        manifest?.pages
          ?.map((page) => page.file)
          .filter((fileName) => entries[fileName]) ??
        Object.keys(entries).filter(
          (name) => name.startsWith("pages/") && name.endsWith(".md")
        );

      if (pageFiles.length === 0) {
        setOfflineImportStatus({
          state: "error",
          message: "No pages found in the archive."
        });
        return;
      }

      let imported = 0;
      let firstPageUid: string | null = null;
      for (const fileName of pageFiles) {
        const content = entries[fileName];
        if (!content) continue;
        const text = strFromU8(content);
        const parsed = parseMarkdownPage(text, makeRandomId);
        if (parsed.page.blocks.length === 0) continue;
        const uid = resolvePageUid(parsed.page.id);
        const title = parsed.page.title.trim() || "Untitled";
        const snapshot = parsed.page.blocks.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent
        }));
        if (!firstPageUid) firstPageUid = uid;

        if (isTauri()) {
          try {
            await invoke("create_page", {
              payload: { uid, title }
            });
          } catch {
            // ignore duplicate errors
          }
          if (title.trim()) {
            await invoke("set_page_title", {
              payload: { page_uid: uid, title }
            });
          }
          await invoke("save_page_blocks", {
            pageUid: uid,
            page_uid: uid,
            blocks: snapshot.map((block) => toPayload(block))
          });
        } else {
          saveLocalPageSnapshot(uid, title, snapshot);
        }

        imported += 1;
      }

      await loadPages();
      if (firstPageUid) {
        await switchPage(firstPageUid);
      }
      setOfflineImportStatus({
        state: "success",
        message: `Imported ${imported} page${imported === 1 ? "" : "s"}.`
      });
      setOfflineImportFile(null);
    } catch (error) {
      console.error("Offline import failed", error);
      setOfflineImportStatus({
        state: "error",
        message: "Offline import failed. Check the logs for details."
      });
    } finally {
      setOfflineImporting(false);
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
      const pageUid = resolvePageUid(activePageUid());
      await invoke("plugin_write_page", {
        pluginId: command.plugin_id,
        plugin_id: command.plugin_id,
        pageUid,
        page_uid: pageUid,
        blocks: nextBlocks.map((block) => ({
          uid: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
    } catch (error) {
      console.error("Plugin command failed", error);
      setPluginError(
        error instanceof Error ? error.message : "Plugin command failed."
      );
    }
  };

  let searchInputRef: HTMLInputElement | undefined;

  const { SectionJump, SectionJumpLink, focusEditorSection } = createSectionJump({
    mode,
    sidebarOpen,
    setSidebarOpen,
    backlinksOpen,
    setBacklinksOpen,
    activeId,
    getSearchInput: () => searchInputRef
  });

  const openCommandPalette = () => {
    setPaletteOpen(true);
    setPaletteQuery("");
    setPaletteIndex(0);
  };

  const closeCommandPalette = () => {
    setPaletteOpen(false);
    setPaletteQuery("");
    setPaletteIndex(0);
  };

  const paletteCommands = createMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "open-settings",
        label: "Open settings",
        action: () => {
          setSettingsOpen(true);
        }
      }
    ];

    if (mode() !== "editor") {
      items.push({
        id: "switch-editor",
        label: "Switch to editor",
        action: () => {
          setMode("editor");
        }
      });
    }
    if (mode() !== "quick-capture") {
      items.push({
        id: "switch-capture",
        label: "Switch to quick capture",
        action: () => {
          setMode("quick-capture");
        }
      });
    }
    if (mode() !== "review") {
      items.push({
        id: "switch-review",
        label: "Switch to review",
        action: () => {
          setMode("review");
        }
      });
    }
    if (mode() === "editor") {
      items.push(
        {
          id: "focus-search",
          label: "Focus search",
          action: () => {
            if (!sidebarOpen()) {
              setSidebarOpen(true);
            }
            requestAnimationFrame(() => {
              searchInputRef?.focus();
            });
          }
        },
        {
          id: "focus-editor",
          label: "Focus editor",
          action: focusEditorSection
        },
        {
          id: "new-page",
          label: "Create new page",
          action: () => {
            const title = prompt("New page title:", "");
            if (!title?.trim()) return;
            setNewPageTitle(title.trim());
            void createPage();
          }
        },
        {
          id: "rename-page",
          label: "Rename current page",
          action: () => {
            const currentTitle = renameTitle().trim() || pageTitle();
            const nextTitle = prompt("Rename page", currentTitle);
            if (!nextTitle?.trim()) return;
            setRenameTitle(nextTitle.trim());
            void renamePage();
          }
        },
        {
          id: "toggle-backlinks",
          label: backlinksOpen() ? "Hide backlinks panel" : "Show backlinks panel",
          action: () => {
            setBacklinksOpen((prev) => !prev);
          }
        }
      );
    }

    if (isTauri() && syncConnected()) {
      items.push({
        id: "sync-now",
        label: "Sync now",
        action: () => void syncNow()
      });
    }

    for (const command of pluginStatus()?.commands ?? []) {
      items.push({
        id: `plugin:${command.id}`,
        label: command.title,
        hint: `Plugin · ${command.plugin_id}`,
        action: () => void runPluginCommand(command)
      });
    }

    return items;
  });

  const filteredPaletteCommands = createMemo(() => {
    const query = paletteQuery().trim().toLowerCase();
    const commands = paletteCommands();
    if (!query) return commands;
    return commands.filter((command) => {
      const label = command.label.toLowerCase();
      const hint = command.hint?.toLowerCase() ?? "";
      return label.includes(query) || hint.includes(query);
    });
  });

  const runPaletteCommand = async (command?: CommandPaletteItem) => {
    if (!command) return;
    closeCommandPalette();
    try {
      await command.action();
    } catch (error) {
      console.error("Command palette action failed", error);
    }
  };

  const movePaletteIndex = (delta: number) => {
    const commands = filteredPaletteCommands();
    if (commands.length === 0) return;
    setPaletteIndex((current) => {
      const next = (current + delta + commands.length) % commands.length;
      return next;
    });
  };

  createEffect(() => {
    paletteQuery();
    setPaletteIndex(0);
  });

  createEffect(() => {
    const commands = filteredPaletteCommands();
    if (commands.length === 0) {
      setPaletteIndex(0);
      return;
    }
    if (paletteIndex() >= commands.length) {
      setPaletteIndex(commands.length - 1);
    }
  });

  createEffect(() => {
    if (!paletteOpen()) return;
    requestAnimationFrame(() => {
      paletteInputRef?.focus();
      paletteInputRef?.select();
    });
  });

  const loadVaults = async () => {
    if (!isTauri()) {
      const fallback = {
        id: "local",
        name: "Sandpaper",
        path: "/vaults/sandpaper"
      };
      setVaults([fallback]);
      setActiveVault(fallback);
      await loadActivePage();
      await loadBlocks(activePageUid());
      await loadPages();
      await ensureDailyNote();
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
      await loadActivePage();
      await loadBlocks(activePageUid());
      await loadPages();
      await ensureDailyNote();
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
    await loadActivePage();
    await loadBlocks(activePageUid());
    await loadPages();
    await ensureDailyNote();
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
      await persistActivePage(DEFAULT_PAGE_UID);
      await loadBlocks(activePageUid());
      await loadPages();
      await ensureDailyNote();
      await loadPlugins();
      await loadVaultKeyStatus();
      await loadSyncConfig();
      await loadReviewSummary();
      await loadReviewQueue();
    }

    setVaultFormOpen(false);
    setNewVaultName("");
    setNewVaultPath("");
    markSaved();
  };

  // Apply typography scale to document
  createEffect(() => {
    document.documentElement.style.setProperty("--type-scale", String(typeScale()));
    localStorage.setItem("sandpaper:type-scale", String(typeScale()));
  });

  onMount(() => {
    // Load typography scale from localStorage
    const savedScale = localStorage.getItem("sandpaper:type-scale");
    if (savedScale) {
      const parsed = parseFloat(savedScale);
      if (parsed >= TYPE_SCALE_MIN && parsed <= TYPE_SCALE_MAX) {
        setTypeScale(parsed);
      }
    }

    const perfFlag =
      new URLSearchParams(window.location.search).has("perf") ||
      localStorage.getItem("sandpaper:perf") === "1";
    setPerfEnabled(perfFlag);
    if (perfFlag) {
      setPerfStats(perfTracker.getStats());
    }

    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    void loadVaults();

    onCleanup(() => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      scrollMeter.dispose();
      if (saveTimeout) {
        window.clearTimeout(saveTimeout);
      }
      if (highlightTimeout) {
        window.clearTimeout(highlightTimeout);
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
    setJumpTarget({ id: block.id, caret: "end" });
    setHighlightedBlockId(block.id);
    if (highlightTimeout) {
      window.clearTimeout(highlightTimeout);
    }
    highlightTimeout = window.setTimeout(() => {
      setHighlightedBlockId(null);
    }, 1500);
  };

  return (
    <div class="app">
      <PerfHud enabled={perfEnabled} stats={perfStats} scrollFps={scrollFps} />

      <Topbar
        sidebarOpen={sidebarOpen}
        toggleSidebar={() => setSidebarOpen((prev) => !prev)}
        mode={mode}
        setMode={setMode}
        syncStatus={syncStatus}
        syncStateLabel={syncStateLabel}
        syncStateDetail={syncStateDetail}
        autosaveError={autosaveError}
        autosaved={autosaved}
        autosaveStamp={autosaveStamp}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Show
        when={mode() === "editor"}
        fallback={
          <FocusPanel
            mode={mode}
            sectionJump={SectionJumpLink}
            capture={
              <CapturePane
                text={captureText}
                setText={setCaptureText}
                onCapture={addCapture}
              />
            }
            review={
              <ReviewPane
                summary={reviewSummary}
                items={reviewItems}
                busy={reviewBusy}
                message={reviewMessage}
                templates={reviewTemplates}
                selectedTemplate={selectedReviewTemplate}
                setSelectedTemplate={setSelectedReviewTemplate}
                formatReviewDate={formatReviewDate}
                onAction={handleReviewAction}
                onCreateTemplate={createReviewTemplate}
                isTauri={isTauri}
                activeId={activeId}
                onAddCurrent={addReviewItem}
              />
            }
          />
        }
      >
        <EditorWorkspace
          sidebarOpen={sidebarOpen}
          backlinksOpen={backlinksOpen}
          sidebar={
            <SidebarPanel
              open={sidebarOpen}
              sectionJump={SectionJumpLink}
              footerLabel={() => activeVault()?.name ?? "Default"}
            >
              <SearchPane
                searchInputRef={(el) => {
                  searchInputRef = el;
                }}
                query={searchQuery}
                setQuery={setSearchQuery}
                filter={searchFilter}
                setFilter={setSearchFilter}
                commitTerm={commitSearchTerm}
                history={searchHistory}
                applyTerm={applySearchTerm}
                results={filteredSearchResults}
                renderHighlight={renderSearchHighlight}
                onResultSelect={(block) => {
                  setActiveId(block.id);
                  setJumpTarget({ id: block.id, caret: "start" });
                }}
              >
                <UnlinkedReferencesPane
                  query={searchQuery}
                  references={unlinkedReferences}
                  onLink={linkUnlinkedReference}
                />
                <PagesPane
                  pages={pages}
                  activePageUid={activePageUid}
                  resolvePageUid={resolvePageUid}
                  onSwitch={switchPage}
                  pageMessage={pageMessage}
                  onCreate={() => {
                    const title = prompt("New page title:");
                    if (title?.trim()) {
                      setNewPageTitle(title.trim());
                      void createPage();
                    }
                  }}
                />
              </SearchPane>
            </SidebarPanel>
          }
          editor={
            <div class="main-pane__editor">
              <SectionJump id="editor" label="Editor" />
              <EditorPane
                blocks={blocks}
                setBlocks={setBlocks}
                activeId={activeId}
                setActiveId={setActiveId}
                focusedId={focusedId}
                setFocusedId={setFocusedId}
                highlightedBlockId={highlightedBlockId}
                jumpTarget={jumpTarget}
                setJumpTarget={setJumpTarget}
                createNewBlock={createNewBlock}
                scheduleSave={scheduleSave}
                recordLatency={recordLatency}
                addReviewItem={addReviewItem}
                pageBusy={pageBusy}
                renameTitle={renameTitle}
                setRenameTitle={setRenameTitle}
                renamePage={renamePage}
                pages={pages}
                activePageUid={activePageUid}
                resolvePageUid={resolvePageUid}
                setNewPageTitle={setNewPageTitle}
                createPage={createPage}
                switchPage={switchPage}
                createPageFromLink={createPageFromLink}
                isTauri={isTauri}
                localPages={localPages}
                saveLocalPageSnapshot={saveLocalPageSnapshot}
                snapshotBlocks={snapshotBlocks}
                pageTitle={pageTitle}
                renderersByKind={renderersByKind}
                perfEnabled={perfEnabled}
                scrollMeter={scrollMeter}
              />
            </div>
          }
          backlinks={
            <>
              <BacklinksToggle
                open={backlinksOpen}
                total={totalBacklinks}
                onToggle={() => setBacklinksOpen((prev) => !prev)}
              />
              <BacklinksPanel
                open={backlinksOpen}
                onClose={() => setBacklinksOpen(false)}
                sectionJump={SectionJumpLink}
                activePageBacklinks={activePageBacklinks}
                activeBacklinks={activeBacklinks}
                activeBlock={activeBlock}
                pageTitle={pageTitle}
                groupedPageBacklinks={groupedPageBacklinks}
                supportsMultiPane={supportsMultiPane}
                openPageBacklinkInPane={openPageBacklinkInPane}
                openPageBacklink={openPageBacklink}
                formatBacklinkSnippet={formatBacklinkSnippet}
                onBlockBacklinkSelect={(entry) => {
                  setActiveId(entry.id);
                  setJumpTarget({ id: entry.id, caret: "start" });
                }}
              />
            </>
          }
          pluginPanel={
            <PluginPanelWidget
              panel={activePanel}
              onClose={() => setActivePanel(null)}
            />
          }
        />
      </Show>

      {/* Command Palette */}
      <CommandPalette
        open={paletteOpen}
        onClose={closeCommandPalette}
        query={paletteQuery}
        setQuery={setPaletteQuery}
        inputRef={(el) => {
          paletteInputRef = el;
          if (paletteOpen()) {
            queueMicrotask(() => el.focus());
          }
        }}
        commands={filteredPaletteCommands}
        activeIndex={paletteIndex}
        setActiveIndex={setPaletteIndex}
        moveIndex={movePaletteIndex}
        onRun={runPaletteCommand}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tab={settingsTab}
        setTab={setSettingsTab}
        isTauri={isTauri}
        typeScale={{
          value: typeScale,
          set: setTypeScale,
          min: TYPE_SCALE_MIN,
          max: TYPE_SCALE_MAX,
          step: TYPE_SCALE_STEP,
          defaultPosition: TYPE_SCALE_DEFAULT_POSITION
        }}
        vault={{
          active: activeVault,
          list: vaults,
          applyActiveVault,
          formOpen: vaultFormOpen,
          setFormOpen: setVaultFormOpen,
          newName: newVaultName,
          setNewName: setNewVaultName,
          newPath: newVaultPath,
          setNewPath: setNewVaultPath,
          create: createVault,
          shadowPendingCount,
          keyStatus: vaultKeyStatus,
          passphrase: vaultPassphrase,
          setPassphrase: setVaultPassphrase,
          keyBusy: vaultKeyBusy,
          setKey: setVaultKey,
          keyMessage: vaultKeyMessage
        }}
        sync={{
          status: syncStatus,
          stateLabel: syncStateLabel,
          stateDetail: syncStateDetail,
          serverUrl: syncServerUrl,
          setServerUrl: setSyncServerUrl,
          vaultIdInput: syncVaultIdInput,
          setVaultIdInput: setSyncVaultIdInput,
          deviceIdInput: syncDeviceIdInput,
          setDeviceIdInput: setSyncDeviceIdInput,
          busy: syncBusy,
          connected: syncConnected,
          connect: connectSync,
          syncNow: syncNow,
          message: syncMessage,
          config: syncConfig,
          log: syncLog,
          copyLog: copySyncLog,
          conflicts: syncConflicts,
          resolveConflict: resolveSyncConflict,
          startMerge: startSyncConflictMerge,
          cancelMerge: cancelSyncConflictMerge,
          mergeId: syncConflictMergeId,
          mergeDrafts: syncConflictMergeDrafts,
          setMergeDrafts: setSyncConflictMergeDrafts,
          getConflictPageTitle: getConflictPageTitle
        }}
        plugins={{
          error: pluginError,
          loadRuntime: loadPluginRuntime,
          busy: pluginBusy,
          list: plugins,
          commandStatus: commandStatus,
          status: pluginStatus,
          requestGrant: requestGrantPermission,
          runCommand: runPluginCommand,
          openPanel: openPanel
        }}
        importExport={{
          importText,
          setImportText,
          importStatus,
          setImportStatus,
          importing,
          importMarkdown,
          exporting,
          exportMarkdown,
          exportStatus,
          offlineExporting,
          exportOfflineArchive,
          offlineExportStatus,
          offlineImporting,
          importOfflineArchive,
          offlineImportFile,
          setOfflineImportFile,
          offlineImportStatus,
          setOfflineImportStatus
        }}
      />
      <Show when={permissionPrompt()}>
        {(prompt) => (
          <div class="modal-backdrop" role="presentation">
            <div class="modal" role="dialog" aria-modal="true">
              <div class="modal__header">
                <h3>Grant permission</h3>
              </div>
              <div class="modal__body">
                <p>
                  Allow <strong>{prompt().pluginName}</strong> to use{" "}
                  <strong>{prompt().permission}</strong>?
                </p>
              </div>
              <div class="modal__actions">
                <button class="modal__button" onClick={dismissPermissionPrompt}>
                  Deny
                </button>
                <button class="modal__button is-primary" onClick={grantPermission}>
                  Allow
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

export default MainPage;
