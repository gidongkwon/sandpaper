import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount
} from "solid-js";
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import {
  createShadowWriter,
  serializePageToMarkdown
} from "@sandpaper/core-model";
import { deriveVaultKey } from "@sandpaper/crypto";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";
import { makeBlock } from "../../../entities/block/model/make-block";
import { createAutosave } from "../../../features/autosave/model/use-autosave";
import { createNotifications } from "../../../features/notifications/model/use-notifications";
import { createPluginActions } from "../../../features/plugins/model/use-plugin-actions";
import { createPlugins } from "../../../features/plugins/model/use-plugins";
import { createSync } from "../../../features/sync/model/use-sync";
import { createVaultLoaders } from "../../../features/vault/model/use-vault-loaders";
import type {
  LocalPageRecord,
  PageSummary
} from "../../../entities/page/model/page-types";
import type {
  PluginPanel,
  PluginRenderer
} from "../../../entities/plugin/model/plugin-types";
import type {
  ReviewQueueItem,
  ReviewQueueSummary,
  ReviewSessionState
} from "../../../entities/review/model/review-types";
import type { ReviewThread } from "../../../entities/review/model/review-types";
import type { VaultRecord } from "../../../entities/vault/model/vault-types";
import type { Mode } from "../../../shared/model/mode";
import {
  buildAllBlockTypeShowcaseBlocks,
  buildDefaultBlocks,
  buildEmptyBlocks
} from "../../../shared/lib/blocks/block-seeds";
import { resolveBlockType } from "../../../shared/lib/blocks/block-type-utils";
import { copyToClipboard } from "../../../shared/lib/clipboard/copy-to-clipboard";
import { makeLocalId, makeRandomId } from "../../../shared/lib/id/id-factory";
import { normalizePageUid } from "../../../shared/lib/page/normalize-page-uid";
import {
  createFpsMeter,
  createPerfTracker,
  type PerfStats
} from "../../../shared/lib/perf/perf";
import { createSectionJump } from "../../../widgets/section-jump/section-jump";
import { createBacklinksState } from "./use-backlinks";
import { createCommandPalette } from "./use-command-palette";
import { createImportExportState } from "./use-import-export";
import { createPageDialog } from "./use-page-dialog";
import { createPageOps } from "./use-page-ops";
import { createReviewState } from "./use-review";
import { createSearchState } from "./use-search";
import { createTypeScale } from "./use-type-scale";
import { createVaultKeyState } from "./use-vault-key";
import { createVaultState } from "./use-vaults";
import { shouldFocusModeInput } from "./mode-focus-utils";
import { type MainPageContextValue } from "./main-page-context";
import {
  DEFAULT_PAGE_UID,
  DEFAULT_PAGE_TITLE,
  HIDDEN_INBOX_PAGE_TITLE,
  HIDDEN_INBOX_PAGE_UID,
  buildLocalDefaults,
  resolveInitialBlocks
} from "./main-page-defaults";
import {
  readLocalStorage,
  writeLocalStorage
} from "../../../shared/lib/storage/safe-local-storage";
import { createReviewPageHash } from "./review-session-hash";
import { getReviewDestinationRecommendations } from "./review-destination-recommender";

type JumpTarget = {
  id: string;
  caret: "start" | "end" | "preserve";
};

const CAPTURE_TIMESTAMPS_KEY = "sandpaper:capture:item-timestamps";
const LOCAL_PAGES_KEY = "sandpaper:local:pages";
const REVIEW_THREAD_ORDER_KEY = "sandpaper:capture:review-thread-order";
const REVIEW_ARCHIVED_THREADS_KEY_PREFIX = "sandpaper:review:archived-threads";
const REVIEW_SESSION_KEY_PREFIX = "sandpaper:review:session";
const REVIEW_SESSION_BASELINE_KEY_PREFIX = "sandpaper:review:baseline";

type ReviewSessionBaselineSnapshot = {
  page_uid: string;
  title: string;
  blocks: Block[];
};

const hasTauriInternals = () =>
  typeof window !== "undefined" &&
  Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");

const readStoredCaptureTimestamps = () => {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage?.getItem !== "function"
  ) {
    return {} as Record<string, number>;
  }
  try {
    const raw = window.localStorage.getItem(CAPTURE_TIMESTAMPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number"
      )
    );
  } catch {
    return {};
  }
};

const normalizeStoredBlocks = (value: unknown): Block[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<Block>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.text !== "string" ||
      typeof candidate.indent !== "number"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        text: candidate.text,
        indent: candidate.indent,
        block_type: candidate.block_type
      }
    ];
  });
};

const readStoredLocalPages = (
  fallback: Record<string, LocalPageRecord>
): Record<string, LocalPageRecord> => {
  const raw = readLocalStorage(LOCAL_PAGES_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const storedEntries = Object.entries(parsed).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Partial<LocalPageRecord>;
      const uid =
        typeof candidate.uid === "string" && candidate.uid.trim().length > 0
          ? candidate.uid
          : key;
      if (typeof candidate.title !== "string") return [];
      return [
        [
          uid,
          {
            uid,
            title: candidate.title,
            blocks: normalizeStoredBlocks(candidate.blocks)
          }
        ] as const
      ];
    });
    return {
      ...fallback,
      ...Object.fromEntries(storedEntries)
    };
  } catch {
    return fallback;
  }
};

const readStoredReviewThreadOrder = () => {
  const raw = readLocalStorage(REVIEW_THREAD_ORDER_KEY);
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

const createDefaultReviewSessionState = (): ReviewSessionState => ({
  active_thread_id: null,
  tab: "to-review",
  selected_archived_thread_id: null,
  destination_page_uid: null,
  destination_recommendations: [],
  is_hard_selected: false,
  baseline_page_hash: null,
  last_known_page_hash: null,
  invalidated: false,
  updated_at: 0
});

const normalizeStoredReviewThread = (value: unknown): ReviewThread | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ReviewThread>;
  if (typeof candidate.id !== "string" || typeof candidate.root_text !== "string") {
    return null;
  }
  if (!Array.isArray(candidate.entries)) return null;
  const entries = candidate.entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const next = entry as Partial<ReviewThread["entries"][number]>;
    if (
      typeof next.id !== "string" ||
      typeof next.text !== "string" ||
      typeof next.is_root !== "boolean"
    ) {
      return [];
    }
    return [
      {
        id: next.id,
        text: next.text,
        is_root: next.is_root
      }
    ];
  });
  if (entries.length !== candidate.entries.length) return null;
  return {
    id: candidate.id,
    root_text: candidate.root_text,
    entries,
    status: candidate.status === "archived" ? "archived" : "to-review",
    captured_at_start:
      typeof candidate.captured_at_start === "number" ? candidate.captured_at_start : null,
    captured_at_end:
      typeof candidate.captured_at_end === "number" ? candidate.captured_at_end : null,
    destination_page_uid:
      typeof candidate.destination_page_uid === "string"
        ? candidate.destination_page_uid
        : undefined,
    destination_title:
      typeof candidate.destination_title === "string" ? candidate.destination_title : undefined,
    archived_at: typeof candidate.archived_at === "number" ? candidate.archived_at : undefined
  };
};

const readStoredArchivedReviewThreads = (key: string) => {
  const raw = readLocalStorage(key);
  if (!raw) return [] as ReviewThread[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const normalized = normalizeStoredReviewThread(entry);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
};

const readStoredReviewSession = (key: string): ReviewSessionState => {
  const raw = readLocalStorage(key);
  if (!raw) return createDefaultReviewSessionState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return createDefaultReviewSessionState();
    }
    const candidate = parsed as Partial<ReviewSessionState>;
    return {
      active_thread_id:
        typeof candidate.active_thread_id === "string" ? candidate.active_thread_id : null,
      tab: candidate.tab === "archived" ? "archived" : "to-review",
      selected_archived_thread_id:
        typeof candidate.selected_archived_thread_id === "string"
          ? candidate.selected_archived_thread_id
          : null,
      destination_page_uid:
        typeof candidate.destination_page_uid === "string"
          ? candidate.destination_page_uid
          : null,
      destination_recommendations: Array.isArray(candidate.destination_recommendations)
        ? candidate.destination_recommendations.filter(
            (item): item is ReviewSessionState["destination_recommendations"][number] =>
              Boolean(
                item &&
                  typeof item === "object" &&
                  typeof item.page_uid === "string" &&
                  typeof item.title === "string" &&
                  typeof item.score === "number" &&
                  Array.isArray(item.reasons) &&
                  (item.provider === "heuristic" || item.provider === "ai")
              )
          )
        : [],
      is_hard_selected: candidate.is_hard_selected === true,
      baseline_page_hash:
        typeof candidate.baseline_page_hash === "string"
          ? candidate.baseline_page_hash
          : null,
      last_known_page_hash:
        typeof candidate.last_known_page_hash === "string"
          ? candidate.last_known_page_hash
          : null,
      invalidated: candidate.invalidated === true,
      updated_at: typeof candidate.updated_at === "number" ? candidate.updated_at : 0
    };
  } catch {
    return createDefaultReviewSessionState();
  }
};

const normalizeStoredReviewSessionBaseline = (
  value: unknown
): ReviewSessionBaselineSnapshot | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ReviewSessionBaselineSnapshot>;
  if (typeof candidate.page_uid !== "string" || typeof candidate.title !== "string") {
    return null;
  }
  return {
    page_uid: candidate.page_uid,
    title: candidate.title,
    blocks: normalizeStoredBlocks(candidate.blocks)
  };
};

const readStoredReviewSessionBaseline = (key: string) => {
  const raw = readLocalStorage(key);
  if (!raw) return null;
  try {
    return normalizeStoredReviewSessionBaseline(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const createMainPageState = () => {
  const initialBlocks = resolveInitialBlocks();
  const initialBlockSnapshot = initialBlocks.map((block) => ({ ...block }));
  const initialLocalPages = readStoredLocalPages({
    [DEFAULT_PAGE_UID]: {
      uid: DEFAULT_PAGE_UID,
      title: DEFAULT_PAGE_TITLE,
      blocks: initialBlockSnapshot
    },
    [HIDDEN_INBOX_PAGE_UID]: {
      uid: HIDDEN_INBOX_PAGE_UID,
      title: HIDDEN_INBOX_PAGE_TITLE,
      blocks: []
    }
  });
  const [blocks, setBlocks] = createStore<Block[]>([...initialBlocks]);
  const [pages, setPages] = createSignal<PageSummary[]>([]);
  const [activePageUid, setActivePageUid] = createSignal(DEFAULT_PAGE_UID);
  const [localPages, setLocalPages] = createStore<
    Record<string, LocalPageRecord>
  >(initialLocalPages);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [focusedId, setFocusedId] = createSignal<string | null>(null);
  const [highlightedBlockId] = createSignal<string | null>(null);
  const [mode, setModeState] = createSignal<Mode>("editor");
  const [pageTitle, setPageTitle] = createSignal(DEFAULT_PAGE_TITLE);
  const [pageMessage, setPageMessage] = createSignal<string | null>(null);
  const [pageBusy, setPageBusy] = createSignal(false);
  const [newPageTitle, setNewPageTitle] = createSignal("");
  const [renameTitle, setRenameTitle] = createSignal(DEFAULT_PAGE_TITLE);
  const [captureText, setCaptureText] = createSignal("");
  const [captureReplyToId, setCaptureReplyToId] = createSignal<string | null>(null);
  const [captureItemTimestamps, setCaptureItemTimestamps] = createSignal<
    Record<string, number>
  >(readStoredCaptureTimestamps());
  const [reviewThreadOrder, setReviewThreadOrder] = createSignal<string[]>(
    hasTauriInternals() ? [] : readStoredReviewThreadOrder()
  );
  const [reviewThreadOrderHydrated, setReviewThreadOrderHydrated] = createSignal(
    !hasTauriInternals()
  );
  const [archivedReviewThreads, setArchivedReviewThreads] = createSignal<
    ReviewThread[]
  >([]);
  const [reviewSession, setReviewSession] = createSignal<ReviewSessionState>(
    createDefaultReviewSessionState()
  );
  const [reviewPendingBaselineHash, setReviewPendingBaselineHash] =
    createSignal<string | null>(null);
  const [reviewPendingBaselineSnapshot, setReviewPendingBaselineSnapshot] =
    createSignal<ReviewSessionBaselineSnapshot | null>(null);
  const [reviewSessionBaselineSnapshot, setReviewSessionBaselineSnapshot] =
    createSignal<ReviewSessionBaselineSnapshot | null>(null);
  const [reviewSessionNeedsValidation, setReviewSessionNeedsValidation] =
    createSignal(false);
  const [reviewDestinationTransitioning, setReviewDestinationTransitioning] =
    createSignal(false);
  const [reviewDestinationQuery, setReviewDestinationQuery] = createSignal("");
  const [jumpTarget, setJumpTarget] = createSignal<JumpTarget | null>(null);
  const [vaults, setVaults] = createSignal<VaultRecord[]>([]);
  const [activeVault, setActiveVault] = createSignal<VaultRecord | null>(null);
  const [vaultFormOpen, setVaultFormOpen] = createSignal(false);
  const [newVaultName, setNewVaultName] = createSignal("");
  const [newVaultPath, setNewVaultPath] = createSignal("");
  const [reviewSummary, setReviewSummary] = createSignal<ReviewQueueSummary>({
    due_count: 0,
    next_due_at: null
  });
  const [reviewItems, setReviewItems] = createSignal<ReviewQueueItem[]>([]);
  const [reviewBusy, setReviewBusy] = createSignal(false);
  const [reviewMessage, setReviewMessage] = createSignal<string | null>(null);
  const [selectedReviewTemplate, setSelectedReviewTemplate] =
    createSignal("daily-brief");
  const [shadowPendingCount, setShadowPendingCount] = createSignal(0);
  const [activePanel, setActivePanel] = createSignal<PluginPanel | null>(null);
  const [commandStatus, setCommandStatus] = createSignal<string | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [notificationsOpen, setNotificationsOpen] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal<
    "general" | "vault" | "sync" | "plugins" | "permissions" | "import"
  >("general");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [backlinksOpen, setBacklinksOpen] = createSignal(false);
  const [perfEnabled, setPerfEnabled] = createSignal(false);
  const [perfStats, setPerfStats] = createSignal<PerfStats>({
    count: 0,
    last: null,
    p50: null,
    p95: null
  });
  const [scrollFps, setScrollFps] = createSignal(0);
  const [captureFocusEpoch, setCaptureFocusEpoch] = createSignal(0);
  const [showStatusSurfaces, setShowStatusSurfaces] = createSignal(true);

  let isPaletteOpen = () => false;

  const STATUS_SURFACES_KEY = "sandpaper:ui:status-surfaces";

  const canUseStorage = () =>
    typeof window !== "undefined" &&
    typeof window.localStorage?.getItem === "function" &&
    typeof window.localStorage?.setItem === "function";

  const readStoredToggle = (key: string, fallback: boolean) => {
    if (!canUseStorage()) return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return fallback;
  };

  const isTauri = () => hasTauriInternals();

  const notificationsApi = createNotifications();
  const {
    notifications,
    unreadCount: notificationUnreadCount,
    addNotification,
    markAllRead: markAllNotificationsRead,
    clearAll: clearNotifications,
    dismiss: dismissNotification
  } = notificationsApi;

  const notifyPluginError = (message: string) => {
    addNotification({
      title: "Plugin error",
      message,
      kind: "error"
    });
  };

  const pluginsApi = createPlugins({
    isTauri,
    invoke,
    onRuntimeError: notifyPluginError
  });
  const {
    plugins,
    pluginStatus,
    pluginError,
    pluginErrorDetails,
    pluginBusy,
    permissionPrompt,
    installPath,
    installStatus,
    installing,
    pluginManageStatus,
    pluginSettings,
    pluginSettingsDirty,
    pluginSettingsStatus,
    pluginDevMode,
    setPluginError,
    clearInstallStatus,
    loadPlugins,
    loadPluginRuntime,
    requestGrantPermission,
    grantPermission,
    denyPermission,
    installPlugin,
    updatePlugin,
    removePlugin,
    setInstallPath,
    findPlugin,
    hasPermission,
    updatePluginSetting,
    resetPluginSettings,
    savePluginSettings,
    setPluginDevMode
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

  const blockRenderersByLang = createMemo(() => {
    const map = new Map<string, PluginRenderer>();
    for (const renderer of pluginStatus()?.renderers ?? []) {
      if (renderer.kind !== "block") continue;
      for (const lang of renderer.languages ?? []) {
        if (!map.has(lang)) {
          map.set(lang, renderer);
        }
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

  createEffect(() => {
    if (notificationsOpen()) {
      markAllNotificationsRead();
    }
  });

  let searchInputRef: HTMLInputElement | undefined;

  const searchHistoryKey = createMemo(() => {
    const vaultId = activeVault()?.id ?? "default";
    return `sandpaper:search-history:${vaultId}`;
  });
  const reviewArchivedThreadsKey = createMemo(() => {
    const vaultId = activeVault()?.id ?? "default";
    return `${REVIEW_ARCHIVED_THREADS_KEY_PREFIX}:${vaultId}`;
  });
  const reviewSessionKey = createMemo(() => {
    const vaultId = activeVault()?.id ?? "default";
    return `${REVIEW_SESSION_KEY_PREFIX}:${vaultId}`;
  });
  const reviewSessionBaselineKey = createMemo(() => {
    const vaultId = activeVault()?.id ?? "default";
    return `${REVIEW_SESSION_BASELINE_KEY_PREFIX}:${vaultId}`;
  });

  const searchState = createSearchState({
    blocks: () => blocks,
    isTauri,
    invoke,
    historyKey: searchHistoryKey,
    focusInput: () => searchInputRef?.focus()
  });
  const {
    searchQuery,
    setSearchQuery,
    searchHistory,
    filteredSearchResults,
    commitSearchTerm,
    applySearchTerm,
    renderSearchHighlight
  } = searchState;

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

  const snapshotBlocks = (source: Block[]) =>
    source.map((block) => ({ ...block }));

  const currentReviewPageHash = createMemo(() =>
    createReviewPageHash({
      pageUid: resolvePageUid(activePageUid()),
      title: pageTitle(),
      blocks: snapshotBlocks(blocks)
    })
  );

  const currentReviewPageSnapshot = () => ({
    page_uid: resolvePageUid(activePageUid()),
    title: pageTitle(),
    blocks: snapshotBlocks(blocks)
  });

  const saveLocalPageSnapshot = (pageUid: string, title: string, items: Block[]) => {
    setLocalPages(resolvePageUid(pageUid), {
      uid: resolvePageUid(pageUid),
      title,
      blocks: snapshotBlocks(items)
    });
  };

  const createNewBlock = (text = "", indent = 0) =>
    makeBlock(isTauri() ? makeRandomId() : makeLocalId(), text, indent);

  const toPayload = (block: Block): BlockPayload => ({
    uid: block.id,
    text: block.text,
    indent: block.indent,
    block_type: resolveBlockType(block)
  });

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

  const persistCaptureInboxBlocks = async (items: Block[]) => {
    if (!isTauri()) return;
    try {
      await invoke("save_page_blocks", {
        pageUid: HIDDEN_INBOX_PAGE_UID,
        page_uid: HIDDEN_INBOX_PAGE_UID,
        blocks: items.map((block) => toPayload(block))
      });
    } catch (error) {
      console.error("Failed to persist capture inbox", error);
    }
  };

  const commitCaptureInboxBlocks = (items: Block[]) => {
    const snapshot = snapshotBlocks(items);
    setLocalPages(HIDDEN_INBOX_PAGE_UID, "uid", HIDDEN_INBOX_PAGE_UID);
    setLocalPages(HIDDEN_INBOX_PAGE_UID, "title", HIDDEN_INBOX_PAGE_TITLE);
    setLocalPages(HIDDEN_INBOX_PAGE_UID, "blocks", snapshot);
    void persistCaptureInboxBlocks(items);
  };

  const updateCaptureInboxBlocks = (update: (draft: Block[]) => void) => {
    const next = snapshotBlocks(captureInboxBlocks());
    update(next);
    commitCaptureInboxBlocks(next);
    return next;
  };

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

  const pageOps = createPageOps({
    isTauri,
    invoke,
    pages,
    localPages,
    setLocalPages,
    blocks: () => blocks,
    setBlocks,
    activePageUid,
    setActivePageUid,
    activeVault,
    resolvePageUid,
    loadPages,
    loadBlocks,
    saveLocalPageSnapshot,
    buildEmptyBlocks,
    buildAllBlockTypeShowcaseBlocks,
    makeLocalId,
    makeBlockId: () => (isTauri() ? makeRandomId() : makeLocalId()),
    cancelPendingSave,
    toPayload,
    defaultPageUid: DEFAULT_PAGE_UID,
    state: {
      pageTitle,
      setPageTitle,
      pageMessage,
      setPageMessage,
      pageBusy,
      setPageBusy,
      newPageTitle,
      setNewPageTitle,
      renameTitle,
      setRenameTitle
    }
  });
  const {
    persistActivePage,
    switchPage,
    ensureDailyNote,
    createPage,
    createPageWithAllBlockTypes,
    createPageFromLink,
    renamePage
  } = pageOps;

  const pageDialog = createPageDialog({
    pageTitle,
    renameTitle,
    setRenameTitle,
    setNewPageTitle,
    createPage,
    renamePage
  });
  const {
    pageDialogOpen,
    pageDialogMode,
    pageDialogValue,
    pageDialogTitle,
    pageDialogConfirmLabel,
    pageDialogDisabled,
    setPageDialogValue,
    openNewPageDialog,
    openRenamePageDialog,
    closePageDialog,
    confirmPageDialog
  } = pageDialog;

  const focusModeInput = (nextMode: Mode) => {
    if (nextMode === "quick-capture") {
      setCaptureFocusEpoch((current) => current + 1);
      return;
    }
    if (nextMode === "editor") {
      const target = focusedId() ?? activeId() ?? blocks[0]?.id ?? null;
      if (target) {
        setJumpTarget({ id: target, caret: "preserve" });
      }
    }
  };

  const setMode = (value: Mode | ((current: Mode) => Mode)) => {
    const previous = mode();
    const resolved =
      typeof value === "function"
        ? (value as (current: Mode) => Mode)(previous)
        : value;
    setModeState(resolved);

    if (
      shouldFocusModeInput({
        modeChanged: previous !== resolved,
        paletteOpen: isPaletteOpen(),
        settingsOpen: settingsOpen(),
        notificationsOpen: notificationsOpen(),
        pageDialogOpen: pageDialogOpen(),
        permissionPromptOpen: Boolean(permissionPrompt())
      })
    ) {
      focusModeInput(resolved);
    }

    return resolved;
  };

  createEffect(() => {
    if (resolvePageUid(activePageUid()) !== HIDDEN_INBOX_PAGE_UID) return;
    if (mode() !== "editor") return;
    setMode("quick-capture");
  });

  const switchWorkspacePage = async (pageUid: string) => {
    if (resolvePageUid(pageUid) === HIDDEN_INBOX_PAGE_UID) {
      setMode("quick-capture");
      return;
    }
    await switchPage(pageUid);
  };

  const reviewState = createReviewState({
    isTauri,
    invoke,
    activePageUid,
    resolvePageUid,
    loadReviewSummary,
    loadReviewQueue,
    loadPages,
    state: {
      reviewSummary,
      setReviewSummary,
      reviewItems,
      setReviewItems,
      reviewBusy,
      setReviewBusy,
      reviewMessage,
      setReviewMessage,
      selectedReviewTemplate,
      setSelectedReviewTemplate
    }
  });
  const {
    reviewTemplates,
    formatReviewDate,
    addReviewItem,
    handleReviewAction,
    createReviewTemplate
  } = reviewState;

  const vaultKeyState = createVaultKeyState({
    isTauri,
    invoke,
    deriveVaultKey
  });
  const {
    vaultPassphrase,
    setVaultPassphrase,
    vaultKeyStatus,
    vaultKeyBusy,
    vaultKeyMessage,
    loadVaultKeyStatus,
    setVaultKey
  } = vaultKeyState;

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

  const importExportState = createImportExportState({
    isTauri,
    invoke,
    blocks: () => blocks,
    setBlocks,
    pageTitle,
    setPageTitle,
    pages,
    localPages,
    saveLocalPageSnapshot,
    snapshotBlocks,
    resolvePageUid,
    activePageUid,
    setActiveId,
    setJumpTarget,
    persistActivePage,
    loadPages,
    switchPage,
    makeRandomId,
    toPayload,
    shadowWriter,
    markSaved,
    activeVault,
    defaultPageUid: DEFAULT_PAGE_UID
  });
  const {
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
    setOfflineImportStatus,
    setExportStatus
  } = importExportState;

  const backlinksState = createBacklinksState({
    blocks: () => blocks,
    setBlocks,
    pages,
    localPages,
    activePageUid,
    activeId,
    pageTitle,
    isTauri,
    invoke,
    resolvePageUid,
    scheduleSave,
    setActiveId,
    setJumpTarget,
    switchPage: switchWorkspacePage,
    defaultPageUid: DEFAULT_PAGE_UID
  });
  const {
    activeBlock,
    activeBacklinks,
    activePageBacklinks,
    groupedPageBacklinks,
    totalBacklinks,
    supportsMultiPane,
    openPageBacklink,
    openPageBacklinkInPane,
    formatBacklinkSnippet,
    unlinkedReferences,
    linkUnlinkedReference
  } = backlinksState;

  const pluginActions = createPluginActions({
    isTauri,
    invoke,
    hasPermission,
    findPlugin,
    requestGrantPermission,
    setActivePanel,
    setCommandStatus,
    setPluginError,
    blocks: () => blocks,
    setBlocks,
    scheduleSave,
    activePageUid,
    resolvePageUid,
    makeRandomId,
    makeBlock
  });
  const { openPanel, runPluginCommand } = pluginActions;

  const { SectionJump, SectionJumpLink, focusEditorSection } = createSectionJump({
    mode,
    sidebarOpen,
    setSidebarOpen,
    backlinksOpen,
    setBacklinksOpen,
    activeId,
    getSearchInput: () => searchInputRef
  });

  const commandPalette = createCommandPalette({
    mode,
    setMode,
    sidebarOpen,
    setSidebarOpen,
    backlinksOpen,
    setBacklinksOpen,
    getSearchInput: () => searchInputRef,
    focusEditorSection,
    openNewPageDialog,
    createPageWithAllBlockTypes,
    openRenamePageDialog,
    setSettingsOpen,
    syncConnected,
    syncNow,
    pluginCommands: () => pluginStatus()?.commands ?? [],
    runPluginCommand: (command) => void runPluginCommand(command),
    isTauri
  });
  const {
    paletteOpen,
    paletteQuery,
    setPaletteQuery,
    paletteIndex,
    setPaletteIndex,
    filteredPaletteCommands,
    closeCommandPalette,
    movePaletteIndex,
    runPaletteCommand,
    registerPaletteInput
  } = commandPalette;
  isPaletteOpen = paletteOpen;

  const vaultState = createVaultState({
    isTauri,
    invoke,
    activePageUid,
    persistActivePage,
    loadActivePage,
    loadBlocks,
    loadPages,
    ensureDailyNote,
    loadPlugins,
    loadVaultKeyStatus,
    loadSyncConfig,
    loadCaptureReviewThreadOrder,
    loadReviewSummary,
    loadReviewQueue,
    markSaved,
    clearExportStatus: () => setExportStatus(null),
    clearActivePanel: () => setActivePanel(null),
    clearCommandStatus: () => setCommandStatus(null),
    defaultPageUid: DEFAULT_PAGE_UID,
    state: {
      vaults,
      setVaults,
      activeVault,
      setActiveVault,
      vaultFormOpen,
      setVaultFormOpen,
      newVaultName,
      setNewVaultName,
      newVaultPath,
      setNewVaultPath
    }
  });
  const { loadVaults, applyActiveVault, createVault } = vaultState;

  const typeScale = createTypeScale();

  onMount(() => {
    const perfFlag =
      new URLSearchParams(window.location.search).has("perf") ||
      readStoredToggle("sandpaper:perf", false);
    setPerfEnabled(perfFlag);
    if (perfFlag) {
      setPerfStats(perfTracker.getStats());
    }

    setShowStatusSurfaces(readStoredToggle(STATUS_SURFACES_KEY, true));
    void loadVaults();

    onCleanup(() => {
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

  createEffect(() => {
    const restoredSession = readStoredReviewSession(reviewSessionKey());
    setArchivedReviewThreads(readStoredArchivedReviewThreads(reviewArchivedThreadsKey()));
    setReviewSession(restoredSession);
    setReviewSessionBaselineSnapshot(
      readStoredReviewSessionBaseline(reviewSessionBaselineKey())
    );
    setReviewPendingBaselineHash(null);
    setReviewPendingBaselineSnapshot(null);
    setReviewSessionNeedsValidation(
      restoredSession.is_hard_selected === true &&
        typeof restoredSession.destination_page_uid === "string" &&
        typeof restoredSession.last_known_page_hash === "string"
    );
  });

  createEffect(() => {
    if (!canUseStorage()) return;
    window.localStorage.setItem(
      STATUS_SURFACES_KEY,
      showStatusSurfaces() ? "1" : "0"
    );
  });

  createEffect(() => {
    const blockIds = captureInboxBlocks().map((block) => block.id);
    const blockIdSet = new Set(blockIds);
    const now = Date.now();
    setCaptureItemTimestamps((current) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const id of blockIds) {
        const timestamp = current[id];
        if (typeof timestamp === "number") {
          next[id] = timestamp;
          continue;
        }
        next[id] = now;
        changed = true;
      }
      if (!changed) {
        for (const id of Object.keys(current)) {
          if (!blockIdSet.has(id)) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : current;
    });
  });

  createEffect(() => {
    if (!canUseStorage()) return;
    window.localStorage.setItem(
      CAPTURE_TIMESTAMPS_KEY,
      JSON.stringify(captureItemTimestamps())
    );
  });

  createEffect(() => {
    if (!canUseStorage()) return;
    writeLocalStorage(reviewArchivedThreadsKey(), JSON.stringify(archivedReviewThreads()));
  });

  createEffect(() => {
    if (!canUseStorage()) return;
    writeLocalStorage(reviewSessionKey(), JSON.stringify(reviewSession()));
  });

  createEffect(() => {
    if (!canUseStorage()) return;
    const baseline = reviewSessionBaselineSnapshot();
    if (!baseline) {
      writeLocalStorage(reviewSessionBaselineKey(), "");
      return;
    }
    writeLocalStorage(reviewSessionBaselineKey(), JSON.stringify(baseline));
  });

  createEffect(() => {
    if (isTauri()) return;
    writeLocalStorage(LOCAL_PAGES_KEY, JSON.stringify(localPages));
  });

  const recordLatency = (label: string) => {
    if (!perfEnabled()) return;
    perfTracker.mark(label);
  };

  const visiblePages = createMemo(() =>
    pages().filter((page) => resolvePageUid(page.uid) !== HIDDEN_INBOX_PAGE_UID)
  );

  const captureInboxBlocks = createMemo(
    () => localPages[HIDDEN_INBOX_PAGE_UID]?.blocks ?? []
  );

  const captureItems = createMemo(() => {
    let position = 0;
    const threads: Array<{
      id: string;
      root: {
        block: Block;
        position: number;
        capturedAt: number | null;
      };
      replies: Array<{
        block: Block;
        position: number;
        capturedAt: number | null;
      }>;
    }> = [];
    let currentThread:
      | {
          id: string;
          root: {
            block: Block;
            position: number;
            capturedAt: number | null;
          };
          replies: Array<{
            block: Block;
            position: number;
            capturedAt: number | null;
          }>;
        }
      | undefined;

    for (const block of captureInboxBlocks()) {
      const item = {
        block,
        position: (position += 1),
        capturedAt: captureItemTimestamps()[block.id] ?? null
      };

      if (block.indent > 0 && currentThread) {
        currentThread.replies.push(item);
        continue;
      }

      currentThread = {
        id: block.id,
        root: item,
        replies: []
      };
      threads.push(currentThread);
    }

    return threads;
  });

  const captureReplyTarget = createMemo(() => {
    const replyToId = captureReplyToId();
    if (!replyToId) return null;
    const thread = captureItems().find((item) => item.id === replyToId);
    return thread?.root.block.text ?? null;
  });

  createEffect(() => {
    const captureThreadIds = captureItems().map((thread) => thread.id);
    const captureThreadIdSet = new Set(captureThreadIds);
    const orderedMissing = [...captureItems()]
      .filter((thread) => !reviewThreadOrder().includes(thread.id))
      .sort((left, right) => {
        const leftTime = left.root.capturedAt ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.root.capturedAt ?? Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.root.position - right.root.position;
      })
      .map((thread) => thread.id);
    setReviewThreadOrder((current) => {
      const kept = current.filter((id) => captureThreadIdSet.has(id));
      const missing = orderedMissing.filter((id) => !kept.includes(id));
      if (
        kept.length === current.length &&
        missing.length === 0 &&
        kept.every((id, index) => id === current[index])
      ) {
        return current;
      }
      return [...kept, ...missing];
    });
  });

  createEffect(() => {
    if (!reviewThreadOrderHydrated()) return;
    if (isTauri()) {
      void invoke("set_capture_review_thread_order", {
        order: reviewThreadOrder()
      }).catch((error) => {
        console.error("Failed to persist capture review order", error);
      });
      return;
    }
    if (!canUseStorage()) return;
    window.localStorage.setItem(REVIEW_THREAD_ORDER_KEY, JSON.stringify(reviewThreadOrder()));
  });

  async function loadCaptureReviewThreadOrder() {
    if (!isTauri()) {
      setReviewThreadOrder(readStoredReviewThreadOrder());
      setReviewThreadOrderHydrated(true);
      return;
    }
    try {
      const stored = (await invoke("get_capture_review_thread_order")) as unknown;
      if (Array.isArray(stored)) {
        setReviewThreadOrder(
          stored.filter((entry): entry is string => typeof entry === "string")
        );
      } else {
        setReviewThreadOrder([]);
      }
    } catch (error) {
      console.error("Failed to load capture review order", error);
      setReviewThreadOrder(readStoredReviewThreadOrder());
    } finally {
      setReviewThreadOrderHydrated(true);
    }
  }

  const reviewThreads = createMemo<ReviewThread[]>(() => {
    const byId = new Map(captureItems().map((thread) => [thread.id, thread]));
    return reviewThreadOrder()
      .map((id) => byId.get(id))
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
      .map((thread) => {
        const timestamps = [
          captureItemTimestamps()[thread.root.block.id] ?? null,
          ...thread.replies.map((reply) => captureItemTimestamps()[reply.block.id] ?? null)
        ].filter((value): value is number => typeof value === "number");
        return {
          id: thread.id,
          root_text: thread.root.block.text,
          status: "to-review",
          entries: [
            {
              id: thread.root.block.id,
              text: thread.root.block.text,
              is_root: true
            },
            ...thread.replies.map((reply) => ({
              id: reply.block.id,
              text: reply.block.text,
              is_root: false
            }))
          ],
          captured_at_start: timestamps[0] ?? null,
          captured_at_end: timestamps[timestamps.length - 1] ?? null
        };
      });
  });

  const activeReviewThread = createMemo(
    () =>
      reviewThreads().find((thread) => thread.id === reviewSession().active_thread_id) ?? null
  );

  const selectedArchivedReviewThread = createMemo(
    () =>
      archivedReviewThreads().find(
        (thread) => thread.id === reviewSession().selected_archived_thread_id
      ) ?? null
  );

  const reviewRecentDestinationPageUids = createMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const thread of [...archivedReviewThreads()].reverse()) {
      const destination = thread.destination_page_uid;
      if (!destination || seen.has(destination)) continue;
      seen.add(destination);
      ordered.push(destination);
    }
    return ordered;
  });

  createEffect(() => {
    if (!reviewThreadOrderHydrated()) return;
    const threads = reviewThreads();
    if (threads.length === 0) {
      if (reviewSession().active_thread_id !== null) {
        setReviewSession((current) => ({
          ...current,
          active_thread_id: null,
          updated_at: Date.now()
        }));
      }
      return;
    }

    if (!threads.some((thread) => thread.id === reviewSession().active_thread_id)) {
      setReviewSession((current) => ({
        ...current,
        active_thread_id: threads[0].id,
        updated_at: Date.now()
      }));
    }
  });

  createEffect((configuredThreadId: string | null) => {
    if (reviewSession().tab !== "to-review") return configuredThreadId ?? null;
    const thread = activeReviewThread();
    const threadId = thread?.id ?? null;

    if (!threadId) {
      if (
        configuredThreadId !== null ||
        reviewSession().destination_page_uid !== null ||
        reviewSession().destination_recommendations.length > 0
      ) {
        setReviewSession((current) => ({
          ...current,
          destination_page_uid: null,
          destination_recommendations: [],
          is_hard_selected: false,
          baseline_page_hash: null,
          last_known_page_hash: null,
          invalidated: false,
          updated_at: Date.now()
        }));
      }
      return null;
    }

    if (configuredThreadId === threadId) return configuredThreadId;

    const recommendations = getReviewDestinationRecommendations({
      thread,
      pages: visiblePages(),
      recentDestinationPageUids: reviewRecentDestinationPageUids()
    });

    setReviewSession((current) => ({
      ...current,
      active_thread_id: threadId,
      selected_archived_thread_id: null,
      destination_page_uid: recommendations[0]?.page_uid ?? null,
      destination_recommendations: recommendations,
      is_hard_selected: false,
      baseline_page_hash: null,
      last_known_page_hash: null,
      invalidated: false,
      updated_at: Date.now()
    }));
    setReviewDestinationQuery("");
    clearReviewBaselineState();
    return threadId;
  }, null);

  createEffect(() => {
    if (reviewDestinationTransitioning()) return;
    const destinationPageUid = reviewSession().destination_page_uid;
    if (!destinationPageUid) return;
    if (resolvePageUid(activePageUid()) === resolvePageUid(destinationPageUid)) {
      if (!reviewSession().is_hard_selected && reviewPendingBaselineHash() === null) {
        setReviewPendingBaselineFromCurrentPage();
      }
      return;
    }
    void switchPage(destinationPageUid);
  });

  createEffect(() => {
    const session = reviewSession();
    const destinationPageUid = session.destination_page_uid;
    const pendingBaselineHash = reviewPendingBaselineHash();
    if (!destinationPageUid || session.is_hard_selected || !pendingBaselineHash) return;
    if (resolvePageUid(activePageUid()) !== resolvePageUid(destinationPageUid)) return;
    if (currentReviewPageHash() === pendingBaselineHash) return;
    setReviewSession((current) => ({
      ...current,
      is_hard_selected: true,
      baseline_page_hash: pendingBaselineHash,
      last_known_page_hash: currentReviewPageHash(),
      updated_at: Date.now()
    }));
    setReviewSessionBaselineSnapshot(reviewPendingBaselineSnapshot());
    setReviewPendingBaselineHash(null);
    setReviewPendingBaselineSnapshot(null);
    setReviewSessionNeedsValidation(false);
  });

  createEffect(() => {
    const session = reviewSession();
    if (
      !session.is_hard_selected ||
      !session.destination_page_uid ||
      resolvePageUid(activePageUid()) !== resolvePageUid(session.destination_page_uid) ||
      reviewSessionNeedsValidation()
    ) {
      return;
    }
    const currentHash = currentReviewPageHash();
    if (currentHash === session.last_known_page_hash) return;
    setReviewSession((current) => ({
      ...current,
      last_known_page_hash: currentHash,
      updated_at: Date.now()
    }));
  });

  createEffect(() => {
    const session = reviewSession();
    if (
      !reviewSessionNeedsValidation() ||
      !session.is_hard_selected ||
      !session.destination_page_uid ||
      !session.last_known_page_hash ||
      resolvePageUid(activePageUid()) !== resolvePageUid(session.destination_page_uid)
    ) {
      return;
    }
    const currentHash = currentReviewPageHash();
    if (currentHash === session.last_known_page_hash) {
      setReviewSessionNeedsValidation(false);
      return;
    }
    setReviewSession((current) => ({
      ...current,
      is_hard_selected: false,
      baseline_page_hash: null,
      last_known_page_hash: null,
      invalidated: true,
      updated_at: Date.now()
    }));
    setReviewSessionBaselineSnapshot(null);
    setReviewSessionNeedsValidation(false);
  });

  const reviewDestinationMatches = createMemo(() => {
    const query = reviewDestinationQuery().trim().toLowerCase();
    if (!query) return [];
    return visiblePages().filter((page) =>
      page.title.toLowerCase().includes(query)
    );
  });

  const reviewDestinationHasExactMatch = createMemo(() => {
    const query = reviewDestinationQuery().trim();
    if (!query) return false;
    const normalized = resolvePageUid(query);
    return visiblePages().some(
      (page) =>
        resolvePageUid(page.uid) === normalized ||
        resolvePageUid(page.title) === normalized
    );
  });

  const reviewDestinationSelected = createMemo(
    () => reviewSession().destination_page_uid !== null
  );

  const reviewDestinationTitle = createMemo(() =>
    reviewDestinationSelected() ? pageTitle() : null
  );

  const setReviewPendingBaselineFromCurrentPage = () => {
    setReviewPendingBaselineHash(currentReviewPageHash());
    setReviewPendingBaselineSnapshot(currentReviewPageSnapshot());
  };

  const clearReviewBaselineState = () => {
    setReviewPendingBaselineHash(null);
    setReviewPendingBaselineSnapshot(null);
    setReviewSessionBaselineSnapshot(null);
    setReviewSessionNeedsValidation(false);
  };

  const discardReviewSessionChanges = async () => {
    const session = reviewSession();
    const baseline = reviewSessionBaselineSnapshot();
    if (
      !session.destination_page_uid ||
      !session.is_hard_selected ||
      !session.baseline_page_hash ||
      !baseline ||
      baseline.page_uid !== resolvePageUid(session.destination_page_uid) ||
      resolvePageUid(activePageUid()) !== resolvePageUid(session.destination_page_uid)
    ) {
      return;
    }

    cancelPendingSave(resolvePageUid(session.destination_page_uid));
    const snapshot = snapshotBlocks(baseline.blocks);
    setPageTitle(baseline.title);
    setBlocks(snapshot);
    setActiveId(snapshot[0]?.id ?? null);
    setFocusedId(snapshot[0]?.id ?? null);
    saveLocalPageSnapshot(baseline.page_uid, baseline.title, snapshot);
    await persistBlocks(
      baseline.page_uid,
      snapshot.map((block) => toPayload(block)),
      baseline.title,
      snapshot
    );
    scheduleShadowWrite(baseline.page_uid);
    markSaved();
    setReviewSession((current) => ({
      ...current,
      is_hard_selected: false,
      baseline_page_hash: null,
      last_known_page_hash: null,
      invalidated: false,
      updated_at: Date.now()
    }));
    clearReviewBaselineState();
  };

  const editCaptureItem = (id: string, text: string) => {
    let updated = false;
    updateCaptureInboxBlocks((draft) => {
      const target = draft.find((block) => block.id === id);
      if (!target || target.text === text) return;
      target.text = text;
      updated = true;
    });
    if (!updated) return;
  };

  const deleteCaptureItem = (id: string) => {
    updateCaptureInboxBlocks((draft) => {
      const index = draft.findIndex((block) => block.id === id);
      if (index < 0) return;
      draft.splice(index, 1);
    });
    setCaptureItemTimestamps((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const deleteCaptureThread = (id: string) => {
    const existingThread = captureItems().find((thread) => thread.id === id) ?? null;
    updateCaptureInboxBlocks((draft) => {
      const rootIndex = draft.findIndex(
        (block) => block.id === id && block.indent === 0
      );
      if (rootIndex < 0) return;

      let threadEndIndex = rootIndex + 1;
      while (threadEndIndex < draft.length && draft[threadEndIndex]?.indent > 0) {
        threadEndIndex += 1;
      }

      draft.splice(rootIndex, threadEndIndex - rootIndex);
    });
    setCaptureItemTimestamps((current) => {
      let changed = false;
      const next = { ...current };
      delete next[id];
      for (const reply of existingThread?.replies ?? []) {
        if (!(reply.block.id in next)) continue;
        delete next[reply.block.id];
        changed = true;
      }
      if (id in current) changed = true;
      return changed ? next : current;
    });

    if (captureReplyToId() === id) {
      setCaptureReplyToId(null);
    }
    setReviewThreadOrder((current) => current.filter((threadId) => threadId !== id));
    setReviewSession((current) => ({
      ...current,
      active_thread_id: current.active_thread_id === id ? null : current.active_thread_id,
      updated_at: Date.now()
    }));
  };

  const startCaptureReply = (id: string) => {
    setCaptureReplyToId(id);
    setCaptureFocusEpoch((current) => current + 1);
  };

  const cancelCaptureReply = () => {
    setCaptureReplyToId(null);
    setCaptureFocusEpoch((current) => current + 1);
  };

  const addCapture = () => {
    const text = captureText().trim();
    if (!text) return;
    const replyToId = captureReplyToId();
    const block = createNewBlock(text, replyToId ? 1 : 0);
    const capturedAt = Date.now();
    setCaptureItemTimestamps((current) => ({
      ...current,
      [block.id]: capturedAt
    }));
    updateCaptureInboxBlocks((draft) => {
      if (!replyToId) {
        draft.push(block);
        return;
      }

      const rootIndex = draft.findIndex(
        (item) => item.id === replyToId && item.indent === 0
      );
      if (rootIndex < 0) {
        draft.push({ ...block, indent: 0 });
        return;
      }

      let threadEndIndex = rootIndex + 1;
      while (threadEndIndex < draft.length && draft[threadEndIndex]?.indent > 0) {
        threadEndIndex += 1;
      }
      const threadBlocks = draft.splice(rootIndex, threadEndIndex - rootIndex);
      threadBlocks.push(block);
      draft.push(...threadBlocks);
    });
    if (!replyToId) {
      setReviewThreadOrder((current) =>
        current.includes(block.id) ? current : [...current, block.id]
      );
      setReviewSession((current) => ({
        ...current,
        active_thread_id: current.active_thread_id ?? block.id,
        updated_at: Date.now()
      }));
    }
    setCaptureText("");
    setCaptureFocusEpoch((current) => current + 1);
  };

  const openReviewDestination = async (pageUid: string) => {
    const destinationPageUid = resolvePageUid(pageUid);
    setReviewDestinationTransitioning(true);
    try {
      setReviewSession((current) => ({
        ...current,
        destination_page_uid: destinationPageUid,
        is_hard_selected: false,
        baseline_page_hash: null,
        last_known_page_hash: null,
        invalidated: false,
        updated_at: Date.now()
      }));
      await switchPage(destinationPageUid);
      setReviewDestinationQuery("");
      setReviewPendingBaselineFromCurrentPage();
      setReviewSessionBaselineSnapshot(null);
      setReviewSessionNeedsValidation(false);
    } finally {
      setReviewDestinationTransitioning(false);
    }
  };

  const openArchivedReviewThread = async (threadId: string) => {
    const archivedThread =
      archivedReviewThreads().find((thread) => thread.id === threadId) ?? null;
    if (!archivedThread) return;
    setReviewSession((current) => ({
      ...current,
      selected_archived_thread_id: threadId,
      tab: "archived",
      updated_at: Date.now()
    }));
    const destinationTarget =
      archivedThread.destination_title ?? archivedThread.destination_page_uid ?? null;
    if (destinationTarget) {
      await openReviewDestination(destinationTarget);
    }
  };

  const createReviewDestination = async () => {
    const title = reviewDestinationQuery().trim();
    if (!title) return;
    setReviewDestinationTransitioning(true);
    try {
      setNewPageTitle(title);
      await createPage();
      const createdPageUid =
        visiblePages().find((page) => resolvePageUid(page.title) === resolvePageUid(title))
          ?.uid ?? resolvePageUid(title);
      setReviewSession((current) => ({
        ...current,
        destination_page_uid: resolvePageUid(createdPageUid),
        is_hard_selected: false,
        baseline_page_hash: null,
        last_known_page_hash: null,
        invalidated: false,
        updated_at: Date.now()
      }));
      setReviewDestinationQuery("");
      setReviewPendingBaselineFromCurrentPage();
      setReviewSessionBaselineSnapshot(null);
      setReviewSessionNeedsValidation(false);
    } finally {
      setReviewDestinationTransitioning(false);
    }
  };

  const completeReview = () => {
    if (!reviewDestinationSelected()) return;
    const threadId = reviewSession().active_thread_id;
    if (!threadId) return;
    const completedThread =
      reviewThreads().find((thread) => thread.id === threadId) ?? null;
    if (completedThread) {
      setArchivedReviewThreads((current) => [
        ...current,
        {
          ...completedThread,
          status: "archived",
          destination_page_uid: reviewSession().destination_page_uid ?? undefined,
          destination_title: pageTitle(),
          archived_at: Date.now()
        }
      ]);
    }
    deleteCaptureThread(threadId);
    setReviewSession((current) => ({
      ...current,
      destination_page_uid: null,
      is_hard_selected: false,
      baseline_page_hash: null,
      last_known_page_hash: null,
      invalidated: false,
      updated_at: Date.now()
    }));
    clearReviewBaselineState();
  };

  const canCompleteReview = createMemo(() => {
    const session = reviewSession();
    if (!session.destination_page_uid || !session.active_thread_id) return false;
    if (!session.is_hard_selected || !session.baseline_page_hash) return false;
    if (session.invalidated) return false;
    if (resolvePageUid(activePageUid()) !== resolvePageUid(session.destination_page_uid)) {
      return false;
    }
    return currentReviewPageHash() !== session.baseline_page_hash;
  });

  const reviewHasDiscardableChanges = createMemo(() => {
    const session = reviewSession();
    if (!session.destination_page_uid) return false;
    if (!session.is_hard_selected || !session.baseline_page_hash) return false;
    if (session.invalidated) return false;
    if (resolvePageUid(activePageUid()) !== resolvePageUid(session.destination_page_uid)) {
      return false;
    }
    return currentReviewPageHash() !== session.baseline_page_hash;
  });

  const editorWorkspace = {
    blocks,
    setBlocks,
    activeId,
    setActiveId,
    focusedId,
    setFocusedId,
    highlightedBlockId,
    jumpTarget,
    setJumpTarget,
    createNewBlock,
    scheduleSave,
    recordLatency,
    addReviewItem,
    pageBusy,
    renameTitle,
    setRenameTitle,
    renamePage,
    pages: visiblePages,
    activePageUid,
    resolvePageUid,
    setNewPageTitle,
    createPage,
    switchPage: switchWorkspacePage,
    createPageFromLink,
    isTauri,
    localPages,
    saveLocalPageSnapshot,
    snapshotBlocks,
    pageTitle,
    renderersByKind,
    blockRenderersByLang,
    perfEnabled,
    scrollMeter
  };

  const mainPageContext: MainPageContextValue = {
    workspace: {
      mode,
      sidebarOpen,
      backlinksOpen,
      sectionJump: { SectionJump, SectionJumpLink },
      sidebar: {
        footerLabel: () => activeVault()?.name ?? "Default",
        connectionState: () => syncStatus().state,
        connectionLabel: syncStateLabel,
        connectionDetail: syncStateDetail,
        search: {
          inputRef: (el) => {
            searchInputRef = el;
          },
          query: searchQuery,
          setQuery: setSearchQuery,
          commitTerm: commitSearchTerm,
          history: searchHistory,
          applyTerm: applySearchTerm,
          results: filteredSearchResults,
          renderHighlight: renderSearchHighlight,
          onResultSelect: (block) => {
            setActiveId(block.id);
            setJumpTarget({ id: block.id, caret: "start" });
          }
        },
        unlinked: {
          query: searchQuery,
          references: unlinkedReferences,
          onLink: linkUnlinkedReference
        },
        pages: {
          pages: visiblePages,
          activePageUid,
          resolvePageUid,
          onSwitch: switchWorkspacePage,
          pageMessage,
          onCreate: () => {
            openNewPageDialog();
          }
        }
      },
      editor: editorWorkspace,
      backlinksToggle: {
        open: backlinksOpen,
        total: totalBacklinks,
        onToggle: () => setBacklinksOpen((prev) => !prev)
      },
      backlinks: {
        open: backlinksOpen,
        onClose: () => setBacklinksOpen(false),
        sectionJump: SectionJumpLink,
        activePageBacklinks,
        activeBacklinks,
        activeBlock,
        pageTitle,
        groupedPageBacklinks,
        supportsMultiPane,
        openPageBacklinkInPane,
        openPageBacklink,
        formatBacklinkSnippet,
        onBlockBacklinkSelect: (entry) => {
          setActiveId(entry.id);
          setJumpTarget({ id: entry.id, caret: "start" });
        }
      },
      pluginPanel: {
        panel: activePanel,
        onClose: () => setActivePanel(null)
      },
      capture: {
        text: captureText,
        setText: setCaptureText,
        items: captureItems,
        onCapture: addCapture,
        onEditItem: editCaptureItem,
        onDeleteItem: deleteCaptureItem,
        onDeleteThread: deleteCaptureThread,
        onReplyTo: startCaptureReply,
        onCancelReply: cancelCaptureReply,
        replyingToId: captureReplyToId,
        replyingTo: captureReplyTarget,
        focusEpoch: captureFocusEpoch
      },
      review: {
        summary: reviewSummary,
        items: reviewItems,
        busy: reviewBusy,
        message: reviewMessage,
        templates: reviewTemplates,
        selectedTemplate: selectedReviewTemplate,
        setSelectedTemplate: setSelectedReviewTemplate,
        formatReviewDate,
        onAction: handleReviewAction,
        onCreateTemplate: createReviewTemplate,
        isTauri,
        activeId,
        onAddCurrent: addReviewItem,
        threads: reviewThreads,
        activeThread: activeReviewThread,
        archivedThreads: archivedReviewThreads,
        selectedArchivedThread: selectedArchivedReviewThread,
        activeTab: () => reviewSession().tab,
        setActiveTab: (tab) =>
          setReviewSession((current) => ({
            ...current,
            tab,
            updated_at: Date.now()
          })),
        selectedThreadId: () => reviewSession().active_thread_id,
        onSelectThread: (id) => {
          setReviewThreadOrder((current) => {
            if (current[0] === id) return current;
            const remaining = current.filter((threadId) => threadId !== id);
            return [id, ...remaining];
          });
          setReviewSession((current) => ({
            ...current,
            active_thread_id: id,
            tab: "to-review",
            updated_at: Date.now()
          }));
        },
        onOpenArchivedThread: openArchivedReviewThread,
        destinationQuery: reviewDestinationQuery,
        setDestinationQuery: setReviewDestinationQuery,
        destinationMatches: reviewDestinationMatches,
        destinationHasExactMatch: reviewDestinationHasExactMatch,
        destinationTitle: reviewDestinationTitle,
        destinationPageUid: () => reviewSession().destination_page_uid,
        destinationRecommendations: () => reviewSession().destination_recommendations,
        destinationIsHardSelected: () => reviewSession().is_hard_selected,
        invalidated: () => reviewSession().invalidated,
        hasDiscardableChanges: reviewHasDiscardableChanges,
        destinationSelected: reviewDestinationSelected,
        onOpenDestination: openReviewDestination,
        onCreateDestination: createReviewDestination,
        onDiscardReviewChanges: discardReviewSessionChanges,
        onCompleteReview: completeReview,
        canCompleteReview,
        editor: editorWorkspace
      }
    },
    overlays: {
      commandPalette: {
        open: paletteOpen,
        onClose: closeCommandPalette,
        query: paletteQuery,
        setQuery: setPaletteQuery,
        inputRef: registerPaletteInput,
        commands: filteredPaletteCommands,
        activeIndex: paletteIndex,
        setActiveIndex: setPaletteIndex,
        moveIndex: movePaletteIndex,
        onRun: runPaletteCommand
      },
      settings: {
        open: settingsOpen,
        onClose: () => setSettingsOpen(false),
        tab: settingsTab,
        setTab: setSettingsTab,
        isTauri,
        typeScale: {
          value: typeScale.typeScale,
          set: typeScale.setTypeScale,
          min: typeScale.min,
          max: typeScale.max,
          step: typeScale.step,
          defaultPosition: typeScale.defaultPosition
        },
        statusSurfaces: {
          showStatusSurfaces,
          setShowStatusSurfaces
        },
        vault: {
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
        },
        sync: {
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
        },
        plugins: {
          error: pluginError,
          errorDetails: pluginErrorDetails,
          loadRuntime: loadPluginRuntime,
          busy: pluginBusy,
          list: plugins,
          commandStatus: commandStatus,
          status: pluginStatus,
          requestGrant: requestGrantPermission,
          runCommand: runPluginCommand,
          openPanel: openPanel,
          installPath,
          setInstallPath,
          installStatus,
          installing,
          installPlugin,
          updatePlugin,
          removePlugin,
          clearInstallStatus,
          manageStatus: pluginManageStatus,
          settings: pluginSettings,
          settingsDirty: pluginSettingsDirty,
          settingsStatus: pluginSettingsStatus,
          devMode: pluginDevMode,
          updateSetting: updatePluginSetting,
          resetSettings: resetPluginSettings,
          saveSettings: savePluginSettings,
          setDevMode: setPluginDevMode
        },
        importExport: {
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
        }
      },
      pageDialog: {
        open: pageDialogOpen,
        title: pageDialogTitle,
        confirmLabel: pageDialogConfirmLabel,
        confirmDisabled: pageDialogDisabled,
        onConfirm: confirmPageDialog,
        onCancel: closePageDialog,
        mode: pageDialogMode,
        value: pageDialogValue,
        setValue: setPageDialogValue
      },
      notifications: {
        open: notificationsOpen,
        onClose: () => setNotificationsOpen(false),
        notifications,
        onMarkAllRead: markAllNotificationsRead,
        onClear: clearNotifications,
        onDismiss: dismissNotification
      },
      permissionPrompt: {
        prompt: permissionPrompt,
        onDeny: denyPermission,
        onAllow: grantPermission
      }
    }
  };

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const openSettings = () => setSettingsOpen(true);
  const toggleNotifications = () =>
    setNotificationsOpen((prev) => !prev);

  return {
    context: mainPageContext,
    perfHud: {
      enabled: perfEnabled,
      stats: perfStats,
      scrollFps
    },
    topbar: {
      sidebarOpen,
      toggleSidebar,
      mode,
      setMode,
      showStatusSurfaces,
      autosaveError,
      autosaved,
      autosaveStamp,
      notificationsOpen,
      notificationCount: notificationUnreadCount,
      onOpenNotifications: toggleNotifications,
      onOpenSettings: openSettings
    }
  };
};
