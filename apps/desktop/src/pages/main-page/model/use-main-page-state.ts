import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import {
  createShadowWriter,
  serializePageToMarkdown
} from "@sandpaper/core-model";
import { deriveVaultKey } from "@sandpaper/crypto";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";
import { makeBlock } from "../../../entities/block/model/make-block";
import { createAutosave } from "../../../features/autosave/model/use-autosave";
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
  ReviewQueueSummary
} from "../../../entities/review/model/review-types";
import type { VaultRecord } from "../../../entities/vault/model/vault-types";
import type { Mode } from "../../../shared/model/mode";
import {
  buildDefaultBlocks,
  buildEmptyBlocks
} from "../../../shared/lib/blocks/block-seeds";
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
import { type MainPageContextValue } from "./main-page-context";
import {
  DEFAULT_PAGE_UID,
  buildLocalDefaults,
  resolveInitialBlocks
} from "./main-page-defaults";

type JumpTarget = {
  id: string;
  caret: "start" | "end" | "preserve";
};


export const createMainPageState = () => {
  const initialBlocks = resolveInitialBlocks();
  const initialBlockSnapshot = initialBlocks.map((block) => ({ ...block }));
  const [blocks, setBlocks] = createStore<Block[]>([...initialBlocks]);
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
  const [pageTitle, setPageTitle] = createSignal("Inbox");
  const [pageMessage, setPageMessage] = createSignal<string | null>(null);
  const [pageBusy, setPageBusy] = createSignal(false);
  const [newPageTitle, setNewPageTitle] = createSignal("");
  const [renameTitle, setRenameTitle] = createSignal("");
  const [captureText, setCaptureText] = createSignal("");
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

  let searchInputRef: HTMLInputElement | undefined;

  const searchHistoryKey = createMemo(() => {
    const vaultId = activeVault()?.id ?? "default";
    return `sandpaper:search-history:${vaultId}`;
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
    searchFilter,
    setSearchFilter,
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
    indent: block.indent
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
    makeLocalId,
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
    switchPage,
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
      localStorage.getItem("sandpaper:perf") === "1";
    setPerfEnabled(perfFlag);
    if (perfFlag) {
      setPerfStats(perfTracker.getStats());
    }

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

  const mainPageContext: MainPageContextValue = {
    workspace: {
      mode,
      sidebarOpen,
      backlinksOpen,
      sectionJump: { SectionJump, SectionJumpLink },
      sidebar: {
        footerLabel: () => activeVault()?.name ?? "Default",
        search: {
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
        },
        unlinked: {
          query: searchQuery,
          references: unlinkedReferences,
          onLink: linkUnlinkedReference
        },
        pages: {
          pages,
          activePageUid,
          resolvePageUid,
          onSwitch: switchPage,
          pageMessage,
          onCreate: () => {
            openNewPageDialog();
          }
        }
      },
      editor: {
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
        pages,
        activePageUid,
        resolvePageUid,
        setNewPageTitle,
        createPage,
        switchPage,
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
      },
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
        onCapture: addCapture
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
        onAddCurrent: addReviewItem
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
          loadRuntime: loadPluginRuntime,
          busy: pluginBusy,
          list: plugins,
          commandStatus: commandStatus,
          status: pluginStatus,
          requestGrant: requestGrantPermission,
          runCommand: runPluginCommand,
          openPanel: openPanel
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
      permissionPrompt: {
        prompt: permissionPrompt,
        onDeny: denyPermission,
        onAllow: grantPermission
      }
    }
  };

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const openSettings = () => setSettingsOpen(true);

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
      syncStatus,
      syncStateLabel,
      syncStateDetail,
      autosaveError,
      autosaved,
      autosaveStamp,
      onOpenSettings: openSettings
    }
  };
};
