import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
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
import { FocusPanel } from "../widgets/focus-panel/focus-panel";
import { PerfHud } from "../widgets/perf/perf-hud";
import { PluginPanelWidget } from "../widgets/plugins/plugin-panel";
import { ReviewPane } from "../widgets/review/review-pane";
import { SettingsModal } from "../widgets/settings/settings-modal";
import { SidebarContent } from "../widgets/sidebar/sidebar-content";
import { SidebarPanel } from "../widgets/sidebar/sidebar-panel";
import { PermissionPromptModal } from "../widgets/permissions/permission-prompt-modal";
import { createSectionJump } from "../widgets/section-jump/section-jump";
import { Topbar } from "../widgets/topbar/topbar";
import { EditorWorkspace } from "../widgets/workspace/editor-workspace";
import { CommandPalette } from "../features/command-palette/ui/command-palette";
import { createAutosave } from "../features/autosave/model/use-autosave";
import { createPlugins } from "../features/plugins/model/use-plugins";
import { createVaultLoaders } from "../features/vault/model/use-vault-loaders";
import { createSync } from "../features/sync/model/use-sync";
import { ConfirmDialog } from "../shared/ui/confirm-dialog";
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
  PluginRenderer
} from "../entities/plugin/model/plugin-types";
import type {
  ReviewQueueItem,
  ReviewQueueSummary,
  ReviewTemplate
} from "../entities/review/model/review-types";
import type { SearchResult } from "../entities/search/model/search-types";
import type { VaultConfig, VaultKeyStatus, VaultRecord } from "../entities/vault/model/vault-types";
import type { MarkdownExportStatus } from "../shared/model/markdown-export-types";
import type { Mode } from "../shared/model/mode";
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
  const [pageDialogOpen, setPageDialogOpen] = createSignal(false);
  const [pageDialogMode, setPageDialogMode] = createSignal<
    "new" | "rename" | null
  >(null);
  const [pageDialogValue, setPageDialogValue] = createSignal("");
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
  const [pageTitle, setPageTitle] = createSignal("Inbox");
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

  const isTauri = () =>
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");

  const pluginsApi = createPlugins({ isTauri, invoke });
  const {
    plugins,
    pluginStatus,
    pluginError,
    pluginBusy,
    permissionPrompt,
    setPluginError,
    loadPlugins,
    loadPluginRuntime,
    requestGrantPermission,
    grantPermission,
    denyPermission,
    findPlugin,
    hasPermission
  } = pluginsApi;

  const renderersByKind = createMemo(() => {
    const map = new Map<string, PluginRenderer>();
    for (const renderer of pluginStatus()?.renderers ?? []) {
      if (!map.has(renderer.kind)) {
        map.set(renderer.kind, renderer);
      }
    }
    return map;
  });

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

  const openNewPageDialog = () => {
    setPageDialogMode("new");
    setPageDialogValue("");
    setPageDialogOpen(true);
  };

  const openRenamePageDialog = () => {
    const currentTitle = renameTitle().trim() || pageTitle();
    setPageDialogMode("rename");
    setPageDialogValue(currentTitle);
    setPageDialogOpen(true);
  };

  const closePageDialog = () => {
    setPageDialogOpen(false);
    setPageDialogMode(null);
  };

  const pageDialogTitle = createMemo(() =>
    pageDialogMode() === "rename" ? "Rename page" : "New page title"
  );

  const pageDialogConfirmLabel = createMemo(() =>
    pageDialogMode() === "rename" ? "Rename" : "Create"
  );

  const pageDialogDisabled = createMemo(() => {
    const value = pageDialogValue().trim();
    if (!value) return true;
    if (pageDialogMode() === "rename") {
      const currentTitle = renameTitle().trim() || pageTitle();
      return value === currentTitle;
    }
    return false;
  });

  const confirmPageDialog = () => {
    const mode = pageDialogMode();
    const value = pageDialogValue().trim();
    if (!mode) {
      closePageDialog();
      return;
    }
    if (mode === "new") {
      if (!value) {
        closePageDialog();
        return;
      }
      setNewPageTitle(value);
      void createPage();
      closePageDialog();
      return;
    }
    const currentTitle = renameTitle().trim() || pageTitle();
    if (!value || value === currentTitle) {
      closePageDialog();
      return;
    }
    setRenameTitle(value);
    void renamePage();
    closePageDialog();
  };

  let highlightTimeout: number | undefined;
  const autosave = createAutosave({
    isTauri,
    invoke,
    resolvePageUid,
    activePageUid,
    getBlocks: () => blocks,
    pageTitle,
    snapshotBlocks,
    toPayload,
    saveLocalPageSnapshot,
    shadowWriter,
    serializePageToMarkdown,
    onPersistError: (error) => {
      console.error("Failed to save blocks", error);
    }
  });
  const {
    autosaved,
    autosaveStamp,
    autosaveError,
    markSaved,
    markSaving,
    markSaveFailed,
    persistBlocks,
    scheduleSave,
    cancelPendingSave,
    scheduleShadowWrite
  } = autosave;

  const vaultLoaders = createVaultLoaders({
    isTauri,
    invoke,
    localPages,
    setPages,
    activePageUid,
    setActivePageUid,
    activeVault,
    resolvePageUid,
    snapshotBlocks,
    saveLocalPageSnapshot,
    buildLocalDefaults,
    buildEmptyBlocks,
    buildDefaultBlocks,
    makeLocalId,
    makeRandomId,
    setBlocks,
    setPageTitle,
    setRenameTitle,
    setActiveId,
    setFocusedId,
    markSaved,
    toPayload,
    serializePageToMarkdown,
    shadowWriter,
    setReviewSummary,
    setReviewItems,
    setReviewBusy,
    defaultPageUid: DEFAULT_PAGE_UID
  });
  const {
    loadPages,
    loadActivePage,
    loadReviewSummary,
    loadReviewQueue,
    loadBlocks
  } = vaultLoaders;

  const syncApi = createSync({
    isTauri,
    invoke,
    resolvePageUid,
    activePageUid,
    pages,
    localPages,
    getBlocks: () => blocks,
    snapshotBlocks,
    saveLocalPageSnapshot,
    setBlocks,
    pageTitle,
    toPayload,
    makeBlock,
    persistBlocks,
    scheduleShadowWrite,
    markSaving,
    markSaved,
    markSaveFailed,
    loadBlocks,
    vaultKeyStatus,
    copyToClipboard,
    makeRandomId,
    defaultPageUid: DEFAULT_PAGE_UID
  });
  const {
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
  } = syncApi;

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
            openNewPageDialog();
          }
        },
        {
          id: "rename-page",
          label: "Rename current page",
          action: () => {
            openRenamePageDialog();
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
      cancelPendingSave(resolvePageUid(activePageUid()));
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
              <SidebarContent
                search={{
                  inputRef: (el) => {
                    searchInputRef = el;
                  },
                  query: searchQuery,
                  setQuery: setSearchQuery,
                  filter: searchFilter,
                  setFilter: setSearchFilter,
                  commitTerm: commitSearchTerm,
                  history: searchHistory,
                  applyTerm: applySearchTerm,
                  results: filteredSearchResults,
                  renderHighlight: renderSearchHighlight,
                  onResultSelect: (block) => {
                    setActiveId(block.id);
                    setJumpTarget({ id: block.id, caret: "start" });
                  }
                }}
                unlinked={{
                  query: searchQuery,
                  references: unlinkedReferences,
                  onLink: linkUnlinkedReference
                }}
                pages={{
                  pages,
                  activePageUid,
                  resolvePageUid,
                  onSwitch: switchPage,
                  pageMessage,
                  onCreate: () => {
                    openNewPageDialog();
                  }
                }}
              />
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
      <ConfirmDialog
        open={pageDialogOpen}
        title={pageDialogTitle()}
        confirmLabel={pageDialogConfirmLabel()}
        onConfirm={confirmPageDialog}
        onCancel={closePageDialog}
        confirmDisabled={pageDialogDisabled}
      >
        <input
          class="modal__input"
          type="text"
          placeholder={
            pageDialogMode() === "rename" ? "Page title" : "New page title"
          }
          value={pageDialogValue()}
          onInput={(event) => setPageDialogValue(event.currentTarget.value)}
        />
      </ConfirmDialog>
      <PermissionPromptModal
        prompt={permissionPrompt}
        onDeny={denyPermission}
        onAllow={grantPermission}
      />
    </div>
  );
}

export default MainPage;
