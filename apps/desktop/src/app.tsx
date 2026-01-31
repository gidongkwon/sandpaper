import {
  For,
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
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import mermaid from "mermaid";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  buildBacklinks,
  buildWikilinkBacklinks,
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

type Mode = "quick-capture" | "editor" | "review" | "viewer";

type SectionId =
  | "sidebar"
  | "editor"
  | "backlinks"
  | "capture"
  | "review"
  | "viewer";

type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  action: () => void | Promise<void>;
};

type VaultRecord = {
  id: string;
  name: string;
  path: string;
};

type PageSummary = {
  uid: string;
  title: string;
};

type LocalPageRecord = {
  uid: string;
  title: string;
  blocks: Block[];
};

type OfflineExportManifest = {
  version: number;
  exported_at: string;
  page_count: number;
  asset_count: number;
  vault_name?: string;
  pages: Array<{ uid: string; title: string; file: string }>;
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

type SyncLogEntry = {
  id: string;
  at: string;
  action: "push" | "pull";
  count: number;
  status: "ok" | "error";
  detail?: string | null;
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
  conflicts?: SyncConflict[];
};

type SyncConflict = {
  op_id: string;
  page_uid: string;
  block_uid: string;
  local_text: string;
  remote_text: string;
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
  pageUid?: string;
  pageTitle?: string;
};

type UnlinkedReference = {
  pageTitle: string;
  pageUid: string;
  blockId: string;
  blockIndex: number;
  snippet: string;
};

type PageLinkBlock = {
  id: string;
  text: string;
  pageUid: string;
  pageTitle: string;
};

type PageBacklinkRecord = {
  block_uid: string;
  text: string;
  page_uid: string;
  page_title: string;
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

type SlashMenuPosition = {
  x: number;
  y: number;
};

type SlashMenuState = {
  open: boolean;
  blockId: string | null;
  blockIndex: number;
  slashIndex: number;
  position: SlashMenuPosition | null;
};

type WikilinkMenuState = {
  open: boolean;
  blockId: string | null;
  blockIndex: number;
  rangeStart: number;
  rangeEnd: number;
  hasClosing: boolean;
  query: string;
  position: SlashMenuPosition | null;
};

type LinkPreviewState = {
  open: boolean;
  position: SlashMenuPosition | null;
  pageUid: string | null;
  title: string;
  blocks: string[];
  loading: boolean;
};

let nextId = 1;
const ROW_HEIGHT = 44;
const OVERSCAN = 6;
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

const makeLocalId = () => `b${nextId++}`;
const makeRandomId = () => globalThis.crypto?.randomUUID?.() ?? makeLocalId();

const normalizePageUid = (value: string) => {
  let output = "";
  let wasDash = false;
  for (const ch of value) {
    if (/^[A-Za-z0-9]$/.test(ch)) {
      output += ch.toLowerCase();
      wasDash = false;
    } else if (!wasDash) {
      output += "-";
      wasDash = true;
    }
  }
  const trimmed = output.replace(/^-+|-+$/g, "");
  return trimmed || "page";
};

const makeBlock = (id: string, text = "", indent = 0): Block => ({
  id,
  text,
  indent
});

const DIAGRAM_LANGS = new Set(["mermaid", "diagram"]);

type MarkdownList = {
  type: "ul" | "ol";
  items: string[];
};

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

const INLINE_MARKDOWN_PATTERN =
  /(\[\[[^\]]+?\]\]|\[[^\]]+?\]\([^)]+?\)|`[^`]+`|\*\*[^*]+?\*\*|~~[^~]+?~~|\*[^*]+?\*)/g;

const ORDERED_LIST_PATTERN = /^\s*\d+\.\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^\s*[-*+]\s+(.+)$/;

const SLASH_COMMANDS = [
  { id: "link", label: "Link to page" },
  { id: "date", label: "Insert date" },
  { id: "task", label: "Convert to task" }
] as const;

const getCaretPosition = (
  textarea: HTMLTextAreaElement,
  position: number
): SlashMenuPosition => {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, Math.max(0, position));

  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const textareaRect = textarea.getBoundingClientRect();
  const rawLineHeight = parseFloat(style.lineHeight || "");
  const lineHeight = Number.isFinite(rawLineHeight) ? rawLineHeight : 16;
  const offsetX = markerRect.left - mirrorRect.left;
  const offsetY = markerRect.top - mirrorRect.top;

  return {
    x: textareaRect.left + offsetX - textarea.scrollLeft,
    y: textareaRect.top + offsetY - textarea.scrollTop + lineHeight
  };
};

const parseWikilinkToken = (token: string) => {
  if (!token.startsWith("[[") || !token.endsWith("]]")) return null;
  const raw = token.slice(2, -2).trim();
  if (!raw) return null;
  const [beforeAlias, alias] = raw.split("|");
  const [beforeHeading] = beforeAlias.split("#");
  const target = beforeHeading.trim();
  if (!target) return null;
  const label = (alias ?? beforeAlias).trim() || target;
  return { target, label };
};

const parseInlineLinkToken = (token: string) => {
  const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (!match) return null;
  const label = match[1]?.trim() ?? "";
  const href = match[2]?.trim() ?? "";
  if (!label || !href) return null;
  if (href.toLowerCase().startsWith("javascript:")) return null;
  return { label, href };
};

const parseMarkdownList = (text: string): MarkdownList | null => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const orderedMatches = lines.map((line) => line.match(ORDERED_LIST_PATTERN));
  const isOrdered = orderedMatches.every(Boolean);
  const unorderedMatches = lines.map((line) =>
    line.match(UNORDERED_LIST_PATTERN)
  );
  const isUnordered = unorderedMatches.every(Boolean);
  if (!isOrdered && !isUnordered) return null;
  const items = (isOrdered ? orderedMatches : unorderedMatches).map(
    (match) => (match?.[1] ?? "").trim()
  );
  return {
    type: isOrdered ? "ol" : "ul",
    items
  };
};

let mermaidInitialized = false;

const ensureMermaid = () => {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict"
    });
    mermaidInitialized = true;
  }
  return mermaid;
};

const replaceWikilinksInText = (
  text: string,
  fromTitle: string,
  toTitle: string
) => {
  const normalizedFrom = normalizePageUid(fromTitle);
  const normalizedTo = normalizePageUid(toTitle);
  if (!normalizedFrom || normalizedFrom === normalizedTo) return text;
  return text.replace(/\[\[[^\]]+?\]\]/g, (token) => {
    const inner = token.slice(2, -2);
    const raw = inner.trim();
    if (!raw) return token;
    const [targetPart, aliasPart] = raw.split("|");
    const [targetBase, headingPart] = targetPart.split("#");
    const targetTitle = targetBase.trim();
    if (!targetTitle) return token;
    if (normalizePageUid(targetTitle) !== normalizedFrom) return token;
    const nextTarget = toTitle.trim() || targetTitle;
    const headingSuffix = headingPart ? `#${headingPart.trim()}` : "";
    const aliasSuffix = aliasPart ? `|${aliasPart.trim()}` : "";
    return `[[${nextTarget}${headingSuffix}${aliasSuffix}]]`;
  });
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const buildEmptyBlocks = (idFactory: () => string): Block[] => [
  makeBlock(idFactory(), "", 0)
];

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
  const [viewerQuery, setViewerQuery] = createSignal("");
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
  const [slashMenu, setSlashMenu] = createSignal<SlashMenuState>({
    open: false,
    blockId: null,
    blockIndex: -1,
    slashIndex: -1,
    position: null
  });
  const [wikilinkMenu, setWikilinkMenu] = createSignal<WikilinkMenuState>({
    open: false,
    blockId: null,
    blockIndex: -1,
    rangeStart: -1,
    rangeEnd: -1,
    hasClosing: false,
    query: "",
    position: null
  });
  const [linkPreview, setLinkPreview] = createSignal<LinkPreviewState>({
    open: false,
    position: null,
    pageUid: null,
    title: "",
    blocks: [],
    loading: false
  });
  const previewCache = new Map<string, { title: string; blocks: string[] }>();
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
  let vaultFolderPickerRef: HTMLInputElement | undefined;
  let markdownFilePickerRef: HTMLInputElement | undefined;
  let offlineArchivePickerRef: HTMLInputElement | undefined;
  let paletteInputRef: HTMLInputElement | undefined;
  let viewerSearchRef: HTMLInputElement | undefined;

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

  const viewerAllPages = createMemo<PageSummary[]>(() =>
    pages().length > 0
      ? pages()
      : Object.values(localPages).map((page) => ({
          uid: page.uid,
          title: page.title
        }))
  );

  const viewerPages = createMemo<PageSummary[]>(() => {
    const query = viewerQuery().trim().toLowerCase();
    if (!query) return viewerAllPages();
    return viewerAllPages().filter((page) => {
      const title = page.title.toLowerCase();
      const uid = page.uid.toLowerCase();
      return title.includes(query) || uid.includes(query);
    });
  });

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

  const wikilinkQuery = createMemo(() => wikilinkMenu().query.trim());
  const wikilinkMatches = createMemo(() => {
    const query = wikilinkQuery().toLowerCase();
    const entries = pages();
    if (!query) return entries;
    return entries.filter((page) =>
      (page.title || page.uid).toLowerCase().includes(query)
    );
  });
  const wikilinkCreateLabel = createMemo(() => {
    const query = wikilinkQuery();
    if (!query) return null;
    const normalized = normalizePageUid(query);
    const exists = pages().some(
      (page) => normalizePageUid(page.uid || page.title) === normalized
    );
    if (exists) return null;
    return `Create page "${query}"`;
  });

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

  const ViewerPane = () => {
    const pageCount = () => viewerAllPages().length;
    const activeViewerUid = () =>
      resolvePageUid(activePageUid() || DEFAULT_PAGE_UID);

    const findViewerPage = (title: string) => {
      const normalized = normalizePageUid(title);
      return (
        viewerAllPages().find(
          (page) => normalizePageUid(page.uid) === normalized
        ) ??
        viewerAllPages().find(
          (page) => page.title.toLowerCase() === title.toLowerCase()
        ) ??
        null
      );
    };

    const openViewerPage = async (title: string) => {
      const existing = findViewerPage(title);
      if (!existing) return;
      await switchPage(existing.uid);
    };

    const renderViewerInlineMarkdown = (
      text: string
    ): Array<string | JSX.Element> => {
      const nodes: Array<string | JSX.Element> = [];
      let cursor = 0;
      for (const match of text.matchAll(INLINE_MARKDOWN_PATTERN)) {
        const index = match.index ?? 0;
        if (index > cursor) {
          nodes.push(text.slice(cursor, index));
        }
        const token = match[0];
        if (token.startsWith("[[")) {
          const parsed = parseWikilinkToken(token);
          if (parsed) {
            nodes.push(
              <button
                type="button"
                class="wikilink"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void openViewerPage(parsed.target);
                }}
              >
                {parsed.label}
              </button>
            );
          } else {
            nodes.push(token);
          }
        } else if (token.startsWith("[")) {
          const parsed = parseInlineLinkToken(token);
          if (parsed) {
            nodes.push(
              <a
                href={parsed.href}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-link"
              >
                {parsed.label}
              </a>
            );
          } else {
            nodes.push(token);
          }
        } else if (token.startsWith("`")) {
          nodes.push(<code>{token.slice(1, -1)}</code>);
        } else if (token.startsWith("**")) {
          nodes.push(<strong>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith("~~")) {
          nodes.push(<del>{token.slice(2, -2)}</del>);
        } else if (token.startsWith("*")) {
          nodes.push(<em>{token.slice(1, -1)}</em>);
        } else {
          nodes.push(token);
        }
        cursor = index + token.length;
      }
      if (cursor < text.length) {
        nodes.push(text.slice(cursor));
      }
      return nodes;
    };

    const renderViewerDisplay = (text: string): JSX.Element => {
      const list = parseMarkdownList(text);
      if (list) {
        const items = (
          <For each={list.items}>
            {(item) => <li>{renderViewerInlineMarkdown(item)}</li>}
          </For>
        );
        if (list.type === "ol") {
          return <ol class="markdown-list">{items}</ol>;
        }
        return <ul class="markdown-list">{items}</ul>;
      }
      return <span>{renderViewerInlineMarkdown(text)}</span>;
    };

    return (
      <section class="viewer">
        <SectionJump id="viewer" label="Viewer" />
        <div class="viewer__header">
          <div>
            <div class="viewer__eyebrow">Read-only viewer</div>
            <h2 class="viewer__title">{pageTitle()}</h2>
            <div class="viewer__meta">
              {pageCount()} pages · {blocks.length} blocks
            </div>
          </div>
          <button class="viewer__button" onClick={() => setMode("editor")}>
            Open in editor
          </button>
        </div>
        <div class="viewer__controls">
          <input
            ref={(el) => {
              viewerSearchRef = el;
            }}
            class="viewer__search"
            type="search"
            placeholder="Find a page..."
            value={viewerQuery()}
            onInput={(event) => setViewerQuery(event.currentTarget.value)}
          />
        </div>
        <div class="viewer__page-list">
          <Show
            when={viewerPages().length > 0}
            fallback={<div class="viewer__empty">No pages found.</div>}
          >
            <For each={viewerPages()}>
              {(page) => (
                <button
                  class={`viewer-page ${
                    resolvePageUid(page.uid) === activeViewerUid()
                      ? "is-active"
                      : ""
                  }`}
                  onClick={() => void switchPage(page.uid)}
                >
                  <div class="viewer-page__title">
                    {page.title || page.uid}
                  </div>
                  <div class="viewer-page__meta">{page.uid}</div>
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="viewer__content">
          <div class="viewer__content-title">{pageTitle()}</div>
          <Show
            when={blocks.length > 0}
            fallback={<div class="viewer__empty">No blocks yet.</div>}
          >
            <For each={blocks}>
              {(block) => {
                const trimmed = () => block.text.trim();
                return (
                  <div
                    class="viewer-block"
                    style={{ "margin-left": `${block.indent * 18}px` }}
                  >
                    <span class="viewer-block__bullet">•</span>
                    <div class="viewer-block__text">
                      <Show
                        when={trimmed().length > 0}
                        fallback={
                          <span class="viewer-block__placeholder">
                            Empty block
                          </span>
                        }
                      >
                        {renderViewerDisplay(block.text)}
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </section>
    );
  };

  let saveTimeout: number | undefined;
  let highlightTimeout: number | undefined;
  let previewCloseTimeout: number | undefined;
  let saveRequestId = 0;
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

  const copyToClipboard = async (content: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(content);
        return;
      } catch (error) {
        console.warn("Clipboard write failed", error);
      }
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch (error) {
      console.warn("Clipboard fallback failed", error);
    }
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

  const SyncConflictDiagram = () => {
    const [svg, setSvg] = createSignal<string | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    let containerRef: HTMLDivElement | undefined;
    let renderToken = 0;

    createEffect(() => {
      const token = (renderToken += 1);
      setSvg(null);
      setError(null);
      const content = `flowchart LR\n  L[Local edit] --> C{Conflict}\n  R[Remote edit] --> C\n  C --> M[Merged result]`;

      void (async () => {
        try {
          const engine = ensureMermaid();
          const result = await engine.render(
            `mermaid-sync-${makeRandomId()}`,
            content
          );
          if (token !== renderToken) return;
          setSvg(result.svg ?? "");
          if (result.bindFunctions && containerRef) {
            Promise.resolve().then(() => {
              if (token !== renderToken) return;
              result.bindFunctions?.(containerRef);
            });
          }
        } catch {
          if (token !== renderToken) return;
          setError("Conflict diagram unavailable.");
        }
      })();
    });

    return (
      <div class="sync-conflict-diagram">
        <Show
          when={svg()}
          fallback={
            <div class="sync-conflict-diagram__fallback">
              {error() ?? "Rendering conflict diagram..."}
            </div>
          }
        >
          {(value) => (
            <div
              ref={containerRef}
              class="sync-conflict-diagram__svg"
              innerHTML={value() ?? ""}
            />
          )}
        </Show>
      </div>
    );
  };

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
      if (offlineArchivePickerRef) offlineArchivePickerRef.value = "";
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
    if (mode() !== "viewer") {
      items.push({
        id: "switch-viewer",
        label: "Switch to viewer",
        action: () => {
          setMode("viewer");
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

  const getFolderFromFile = (file: File) => {
    const withPath = file as File & { path?: string; webkitRelativePath?: string };
    if (withPath.path) return withPath.path;
    if (withPath.webkitRelativePath) {
      return withPath.webkitRelativePath.split("/")[0] || "";
    }
    return file.name.replace(/\.[^/.]+$/, "");
  };

  const readTextFile = async (file: File) => {
    if (typeof file.text === "function") {
      return file.text();
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
      reader.readAsText(file);
    });
  };

  const readBinaryFile = async (file: File) => {
    if (typeof file.arrayBuffer === "function") {
      try {
        const buffer = await file.arrayBuffer();
        if (buffer.byteLength > 0 || file.size === 0) {
          return new Uint8Array(buffer);
        }
      } catch {
        // fall through to FileReader
      }
    }
    return await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (!reader.result) {
          reject(new Error("read-failed"));
          return;
        }
        resolve(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
      reader.readAsArrayBuffer(file);
    });
  };

  const openVaultFolderPicker = async () => {
    if (isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection === "string") {
        setNewVaultPath(selection);
      }
      return;
    }
    vaultFolderPickerRef?.click();
  };

  const openMarkdownFilePicker = async () => {
    if (isTauri()) {
      const selection = await openDialog({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
      });
      const picked =
        typeof selection === "string" ? selection : selection?.[0] ?? null;
      if (!picked) return;
      try {
        const text = (await invoke("read_text_file", { path: picked })) as string;
        setImportText(text);
        setImportStatus(null);
      } catch (error) {
        console.error("Failed to read import file", error);
        setImportStatus({
          state: "error",
          message: "Failed to read the selected file."
        });
      }
      return;
    }
    markdownFilePickerRef?.click();
  };

  const openOfflineArchivePicker = () => {
    offlineArchivePickerRef?.click();
  };

  const handleVaultFolderPick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const nextPath = getFolderFromFile(file);
    if (nextPath) {
      setNewVaultPath(nextPath);
    }
    input.value = "";
  };

  const handleMarkdownFilePick = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await readTextFile(file);
      setImportText(text);
      setImportStatus(null);
    } catch (error) {
      console.error("Failed to read import file", error);
      setImportStatus({
        state: "error",
        message: "Failed to read the selected file."
      });
    } finally {
      input.value = "";
    }
  };

  const handleOfflineArchivePick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    setOfflineImportFile(file);
    setOfflineImportStatus(null);
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
      if (previewCloseTimeout) {
        window.clearTimeout(previewCloseTimeout);
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

  let searchInputRef: HTMLInputElement | undefined;

  const sectionJumpRefs = new Map<SectionId, HTMLButtonElement>();

  const sectionOrder = createMemo<SectionId[]>(() => {
    if (mode() === "editor") {
      const order: SectionId[] = [];
      if (sidebarOpen()) {
        order.push("sidebar");
      }
      order.push("editor");
      if (backlinksOpen()) {
        order.push("backlinks");
      }
      return order;
    }
    if (mode() === "quick-capture") {
      return ["capture"];
    }
    if (mode() === "review") {
      return ["review"];
    }
    return ["viewer"];
  });

  const focusSectionJump = (id: SectionId) => {
    const target = sectionJumpRefs.get(id);
    if (target && document.body.contains(target)) {
      target.focus();
    }
  };

  const focusAdjacentSection = (current: SectionId, delta: number) => {
    const available = sectionOrder().filter((id) => {
      const el = sectionJumpRefs.get(id);
      return !!el && document.body.contains(el);
    });
    if (available.length === 0) return;
    const index = available.indexOf(current);
    if (index === -1) return;
    const nextIndex = (index + delta + available.length) % available.length;
    focusSectionJump(available[nextIndex]);
  };

  function focusEditorSection() {
    if (mode() !== "editor") return;
    const targetId = activeId();
    if (targetId) {
      const target = document.querySelector<HTMLElement>(
        `[data-block-id="${targetId}"] .block__display`
      );
      if (target) {
        target.click();
        return;
      }
    }
    const fallback = document.querySelector<HTMLElement>(".block__display");
    fallback?.click();
  }

  const activateSection = (id: SectionId) => {
    if (id === "sidebar") {
      if (!sidebarOpen()) {
        setSidebarOpen(true);
      }
      requestAnimationFrame(() => {
        searchInputRef?.focus();
      });
      return;
    }
    if (id === "editor") {
      focusEditorSection();
      return;
    }
    if (id === "backlinks") {
      if (!backlinksOpen()) {
        setBacklinksOpen(true);
      }
      requestAnimationFrame(() => {
        const closeButton = document.querySelector<HTMLButtonElement>(
          ".backlinks-panel__close"
        );
        closeButton?.focus();
      });
      return;
    }
    if (id === "capture") {
      requestAnimationFrame(() => {
        const captureInput = document.querySelector<HTMLTextAreaElement>(
          ".capture__input"
        );
        captureInput?.focus();
      });
      return;
    }
    if (id === "review") {
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          ".review-card__button, .review__button, .review-template"
        );
        target?.focus();
      });
      return;
    }
    if (id === "viewer") {
      requestAnimationFrame(() => {
        viewerSearchRef?.focus();
      });
    }
  };

  const handleSectionJumpKeyDown = (id: SectionId, event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      focusAdjacentSection(id, event.shiftKey ? -1 : 1);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateSection(id);
    }
  };

  const SectionJump = (props: { id: SectionId; label: string }) => {
    let buttonRef: HTMLButtonElement | undefined;
    onCleanup(() => {
      if (buttonRef) {
        sectionJumpRefs.delete(props.id);
      }
    });

    return (
      <button
        ref={(el) => {
          buttonRef = el;
          sectionJumpRefs.set(props.id, el);
        }}
        class="section-jump"
        type="button"
        data-section-jump={props.id}
        aria-label={`${props.label} section`}
        onClick={() => activateSection(props.id)}
        onKeyDown={(event) => handleSectionJumpKeyDown(props.id, event)}
      >
        {props.label}
      </button>
    );
  };

  const EditorPane = (props: { title: string }) => {
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);
    const [copiedBlockId, setCopiedBlockId] = createSignal<string | null>(null);
    const [blockHeights, setBlockHeights] = createStore<Record<string, number>>(
      {}
    );
    const inputRefs = new Map<string, HTMLTextAreaElement>();
    const caretPositions = new Map<string, { start: number; end: number }>();
    let editorRef: HTMLDivElement | undefined;
    let copyTimeout: number | undefined;
    const effectiveViewport = createMemo(() =>
      viewportHeight() === 0 ? 560 : viewportHeight()
    );
    const rowMetrics = createMemo(() => {
      const heights = blocks.map((block) =>
        Math.max(ROW_HEIGHT, blockHeights[block.id] ?? ROW_HEIGHT)
      );
      let offset = 0;
      const offsets = heights.map((height) => {
        const current = offset;
        offset += height;
        return current;
      });
      return { heights, offsets, totalHeight: offset };
    });
    const blockObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            for (const entry of entries) {
              const target = entry.target as HTMLElement;
              const id = target.dataset.blockId;
              if (!id) continue;
              const nextHeight = Math.max(
                ROW_HEIGHT,
                Math.round(entry.contentRect.height)
              );
              const prevHeight = blockHeights[id] ?? ROW_HEIGHT;
              if (nextHeight === prevHeight) continue;
              const index = findIndexById(id);
              if (index >= 0 && index < range().start && editorRef) {
                editorRef.scrollTop += nextHeight - prevHeight;
              }
              setBlockHeights(id, nextHeight);
            }
          })
        : null;

    const observeBlock = (el: HTMLDivElement | undefined) => {
      if (!el || !blockObserver) return;
      blockObserver.observe(el);
      onCleanup(() => {
        blockObserver.unobserve(el);
      });
    };

    onCleanup(() => {
      if (copyTimeout) {
        window.clearTimeout(copyTimeout);
      }
      blockObserver?.disconnect();
    });

    const range = createMemo(() => {
      const metrics = rowMetrics();
      return getVirtualRange({
        count: blocks.length,
        rowHeight: ROW_HEIGHT,
        rowHeights: metrics.heights,
        rowOffsets: metrics.offsets,
        totalHeight: metrics.totalHeight,
        overscan: OVERSCAN,
        scrollTop: scrollTop(),
        viewportHeight: effectiveViewport()
      });
    });

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
      const metrics = rowMetrics();
      const top = metrics.offsets[index] ?? index * ROW_HEIGHT;
      const height = metrics.heights[index] ?? ROW_HEIGHT;
      const bottom = top + height;
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

    const storeSelection = (
      id: string,
      el: HTMLTextAreaElement | null | undefined,
      force = false
    ) => {
      if (!el) return;
      const isFocused = document.activeElement === el || focusedId() === id;
      if (!force && !isFocused) return;
      caretPositions.set(id, {
        start: el.selectionStart ?? 0,
        end: el.selectionEnd ?? 0
      });
    };

    const focusBlock = (
      id: string,
      caret: "start" | "end" | "preserve" = "end"
    ) => {
      const index = findIndexById(id);
      if (index >= 0) scrollToIndex(index);
      setActiveId(id);
      setFocusedId(id);
      requestAnimationFrame(() => {
        const el = inputRefs.get(id);
        if (!el) return;
        el.focus();
        if (caret === "start") {
          el.setSelectionRange(0, 0);
          return;
        }
        if (caret === "end") {
          const pos = el.value.length;
          el.setSelectionRange(pos, pos);
          return;
        }
        const stored = caretPositions.get(id);
        if (stored) {
          el.setSelectionRange(stored.start, stored.end);
          return;
        }
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
      });
    };

    createEffect(() => {
      const target = jumpTarget();
      if (!target) return;
      if (findIndexById(target.id) < 0) return;
      focusBlock(target.id, target.caret);
      setJumpTarget(null);
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

    const duplicateBlockAt = (index: number) => {
      const source = blocks[index];
      if (!source) return;
      const clone = createNewBlock(source.text, source.indent);
      setBlocks(
        produce((draft) => {
          draft.splice(index + 1, 0, clone);
        })
      );
      scheduleSave();
      focusBlock(clone.id, "end");
    };

    const removeBlockAt = (index: number) => {
      if (blocks.length === 1) return;
      const prev = blocks[index - 1];
      const next = blocks[index + 1];
      const removed = blocks[index];
      setBlocks(
        produce((draft) => {
          draft.splice(index, 1);
        })
      );
      if (removed) {
        caretPositions.delete(removed.id);
      }
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

    const closeSlashMenu = () => {
      setSlashMenu((prev) =>
        prev.open ? { ...prev, open: false, position: null } : prev
      );
    };

    const openSlashMenu = (
      block: Block,
      index: number,
      target: HTMLTextAreaElement,
      slashIndex: number
    ) => {
      if (slashIndex < 0) return;
      const caret = Math.min(target.value.length, slashIndex + 1);
      let position: SlashMenuPosition;
      try {
        position = getCaretPosition(target, caret);
      } catch {
        position = { x: 0, y: 0 };
      }
      setSlashMenu({
        open: true,
        blockId: block.id,
        blockIndex: index,
        slashIndex,
        position
      });
      setWikilinkMenu((prev) =>
        prev.open ? { ...prev, open: false, position: null } : prev
      );
    };

    const applySlashCommand = (commandId: string) => {
      const state = slashMenu();
      if (!state.blockId || state.blockIndex < 0 || state.slashIndex < 0) {
        return;
      }
      const index = state.blockIndex;
      const block = blocks[index];
      if (!block || block.id !== state.blockId) {
        closeSlashMenu();
        return;
      }
      const text = block.text;
      const before = text.slice(0, state.slashIndex);
      const after = text.slice(state.slashIndex + 1);
      let nextText = text;
      let nextCaret = before.length;

      if (commandId === "link") {
        const insertText = "[[Page]]";
        nextText = `${before}${insertText}${after}`;
        nextCaret = before.length + insertText.length;
      }

      if (commandId === "date") {
        const insertText = new Date().toISOString().slice(0, 10);
        nextText = `${before}${insertText}${after}`;
        nextCaret = before.length + insertText.length;
      }

      if (commandId === "task") {
        const cleaned = `${before}${after}`.trimStart();
        const prefix = cleaned.startsWith("- [ ] ") || cleaned.startsWith("- [x] ")
          ? ""
          : "- [ ] ";
        nextText = `${prefix}${cleaned}`;
        nextCaret = nextText.length;
      }

      setBlocks(index, "text", nextText);
      scheduleSave();
      closeSlashMenu();
      requestAnimationFrame(() => {
        const input = inputRefs.get(block.id);
        if (!input) return;
        input.focus();
        input.setSelectionRange(nextCaret, nextCaret);
        storeSelection(block.id, input, true);
      });
    };

    const closeWikilinkMenu = () => {
      setWikilinkMenu((prev) =>
        prev.open ? { ...prev, open: false, position: null } : prev
      );
    };

    const updateWikilinkMenu = (
      block: Block,
      index: number,
      target: HTMLTextAreaElement
    ) => {
      const value = target.value;
      const start = value.lastIndexOf("[[");
      if (start < 0) {
        closeWikilinkMenu();
        return;
      }
      const caretRaw = target.selectionStart ?? value.length;
      const caret = caretRaw === 0 ? value.length : caretRaw;
      const closeIndex = value.indexOf("]]", start + 2);
      const hasClosing = closeIndex !== -1;
      if (hasClosing && closeIndex < caret) {
        closeWikilinkMenu();
        return;
      }
      const inner = hasClosing
        ? value.slice(start + 2, closeIndex)
        : value.slice(start + 2);
      const [targetPart] = inner.split("|");
      const [targetBase] = targetPart.split("#");
      const query = targetBase.trim();
      let position: SlashMenuPosition;
      try {
        position = getCaretPosition(target, Math.min(caret, value.length));
      } catch {
        position = { x: 0, y: 0 };
      }
      setWikilinkMenu({
        open: true,
        blockId: block.id,
        blockIndex: index,
        rangeStart: start,
        rangeEnd: hasClosing ? closeIndex + 2 : value.length,
        hasClosing,
        query,
        position
      });
      closeSlashMenu();
    };

    const applyWikilinkSuggestion = (title: string, create = false) => {
      const state = wikilinkMenu();
      if (!state.blockId || state.blockIndex < 0 || state.rangeStart < 0) {
        return;
      }
      const block = blocks[state.blockIndex];
      if (!block || block.id !== state.blockId) {
        closeWikilinkMenu();
        return;
      }
      const text = block.text;
      const before = text.slice(0, state.rangeStart);
      const inner = text.slice(
        state.rangeStart + 2,
        state.rangeEnd - (state.hasClosing ? 2 : 0)
      );
      const after = text.slice(state.rangeEnd);
      const [targetPart, aliasPart] = inner.split("|");
      const [, headingPart] = targetPart.split("#");
      const headingSuffix = headingPart ? `#${headingPart.trim()}` : "";
      const aliasSuffix = aliasPart ? `|${aliasPart.trim()}` : "";
      const nextInner = `${title.trim()}${headingSuffix}${aliasSuffix}`;
      const nextText = `${before}[[${nextInner}]]${after}`;
      setBlocks(state.blockIndex, "text", nextText);
      scheduleSave();
      closeWikilinkMenu();
      if (create) {
        void createPageFromLink(title);
      }
      requestAnimationFrame(() => {
        const input = inputRefs.get(block.id);
        if (!input) return;
        const caret = before.length + 2 + nextInner.length + 2;
        input.focus();
        input.setSelectionRange(caret, caret);
        storeSelection(block.id, input, true);
      });
    };

    const findPageByTitle = (title: string) => {
      const normalized = normalizePageUid(title);
      return (
        pages().find((page) => normalizePageUid(page.uid) === normalized) ??
        pages().find(
          (page) => page.title.toLowerCase() === title.toLowerCase()
        ) ??
        null
      );
    };

    const openPageByTitle = async (title: string) => {
      const existing = findPageByTitle(title);
      if (existing) {
        await switchPage(existing.uid);
        return;
      }
      setNewPageTitle(title);
      await createPage();
    };

    const linkToPageFromBlock = async (block: Block, index: number) => {
      const response = prompt("Link to page", "");
      if (response === null) return;
      const title = response.trim();
      if (!title) return;
      const link = `[[${title}]]`;
      const separator = block.text.trim().length ? " " : "";
      const nextText = `${block.text}${separator}${link}`;
      setBlocks(index, "text", nextText);
      if (!isTauri()) {
        const snapshot = snapshotBlocks(blocks);
        if (snapshot[index]) {
          snapshot[index].text = nextText;
        }
        saveLocalPageSnapshot(activePageUid(), pageTitle(), snapshot);
      }
      scheduleSave();

      await openPageByTitle(title);
    };

    const closeLinkPreview = () => {
      setLinkPreview((prev) =>
        prev.open ? { ...prev, open: false, position: null } : prev
      );
    };

    const cancelLinkPreviewClose = () => {
      if (previewCloseTimeout) {
        window.clearTimeout(previewCloseTimeout);
        previewCloseTimeout = undefined;
      }
    };

    const scheduleLinkPreviewClose = () => {
      cancelLinkPreviewClose();
      previewCloseTimeout = window.setTimeout(() => {
        closeLinkPreview();
      }, 120);
    };

    const loadPreviewBlocks = async (pageUid: string) => {
      if (!isTauri()) {
        const local = localPages[pageUid];
        return (
          local?.blocks.map((block) => block.text).filter(Boolean).slice(0, 2) ??
          []
        );
      }
      try {
        const response = (await invoke("load_page_blocks", {
          pageUid,
          page_uid: pageUid
        })) as PageBlocksResponse;
        return response.blocks
          .map((block) => block.text)
          .filter((text) => text.trim().length > 0)
          .slice(0, 2);
      } catch (error) {
        console.error("Failed to load link preview", error);
        return [];
      }
    };

    const openLinkPreview = async (
      targetTitle: string,
      anchor: HTMLElement
    ) => {
      cancelLinkPreviewClose();
      const resolved = findPageByTitle(targetTitle);
      const pageUid = resolvePageUid(resolved?.uid ?? targetTitle);
      const rect = anchor.getBoundingClientRect();
      const position = {
        x: rect.left,
        y: rect.bottom + 8
      };
      const cached = previewCache.get(pageUid);
      if (cached) {
        setLinkPreview({
          open: true,
          position,
          pageUid,
          title: cached.title,
          blocks: cached.blocks,
          loading: false
        });
        return;
      }
      setLinkPreview({
        open: true,
        position,
        pageUid,
        title: resolved?.title ?? targetTitle,
        blocks: [],
        loading: true
      });
      const blocks = await loadPreviewBlocks(pageUid);
      const title = resolved?.title ?? targetTitle;
      previewCache.set(pageUid, { title, blocks });
      setLinkPreview((prev) => ({
        ...prev,
        blocks,
        loading: false
      }));
    };

    const handleKeyDown = (block: Block, index: number, event: KeyboardEvent) => {
      const target = event.currentTarget as HTMLTextAreaElement;
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd =
        target.selectionStart === target.value.length &&
        target.selectionEnd === target.value.length;

      if (event.key === "Escape") {
        event.preventDefault();
        storeSelection(block.id, target, true);
        target.blur();
        return;
      }

      if (event.key === "/") {
        requestAnimationFrame(() => {
          const value = target.value;
          const slashIndex = value.lastIndexOf("/");
          const isSlash = slashIndex === value.length - 1;
          if (isSlash) {
            openSlashMenu(block, index, target, slashIndex);
          }
        });
      }

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

    const renderInlineMarkdown = (text: string): Array<string | JSX.Element> => {
      const nodes: Array<string | JSX.Element> = [];
      let cursor = 0;
      for (const match of text.matchAll(INLINE_MARKDOWN_PATTERN)) {
        const index = match.index ?? 0;
        if (index > cursor) {
          nodes.push(text.slice(cursor, index));
        }
        const token = match[0];
        if (token.startsWith("[[")) {
          const parsed = parseWikilinkToken(token);
          if (parsed) {
            nodes.push(
              <button
                type="button"
                class="wikilink"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void openPageByTitle(parsed.target);
                }}
                onMouseEnter={(event) =>
                  void openLinkPreview(parsed.target, event.currentTarget)
                }
                onMouseLeave={() => scheduleLinkPreviewClose()}
                onFocus={(event) =>
                  void openLinkPreview(parsed.target, event.currentTarget)
                }
                onBlur={() => scheduleLinkPreviewClose()}
              >
                {parsed.label}
              </button>
            );
          } else {
            nodes.push(token);
          }
        } else if (token.startsWith("[")) {
          const parsed = parseInlineLinkToken(token);
          if (parsed) {
            nodes.push(
              <a
                href={parsed.href}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-link"
              >
                {parsed.label}
              </a>
            );
          } else {
            nodes.push(token);
          }
        } else if (token.startsWith("`")) {
          nodes.push(<code>{token.slice(1, -1)}</code>);
        } else if (token.startsWith("**")) {
          nodes.push(<strong>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith("~~")) {
          nodes.push(<del>{token.slice(2, -2)}</del>);
        } else if (token.startsWith("*")) {
          nodes.push(<em>{token.slice(1, -1)}</em>);
        } else {
          nodes.push(token);
        }
        cursor = index + token.length;
      }
      if (cursor < text.length) {
        nodes.push(text.slice(cursor));
      }
      return nodes;
    };

    const renderCodePreview = (
      code: CodeFence & { renderer: PluginRenderer },
      blockId: string
    ) => (
      <div class="block-renderer block-renderer--code">
        <div class="block-renderer__header">
          <div class="block-renderer__heading">
            <div class="block-renderer__title">Code preview</div>
            <div class="block-renderer__meta">
              <span class="block-renderer__badge">
                {code.lang.toUpperCase()}
              </span>
              <span>{code.renderer.title}</span>
            </div>
          </div>
          <button
            class="block-renderer__copy"
            type="button"
            aria-label="Copy code"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void copyToClipboard(code.content);
              setCopiedBlockId(blockId);
              if (copyTimeout) {
                window.clearTimeout(copyTimeout);
              }
              copyTimeout = window.setTimeout(() => {
                setCopiedBlockId(null);
              }, 1200);
            }}
          >
            {copiedBlockId() === blockId ? "Copied" : "Copy"}
          </button>
        </div>
        <pre class="block-renderer__content">
          <code>{code.content}</code>
        </pre>
      </div>
    );

    const DiagramPreview = (props: {
      diagram: CodeFence & { renderer: PluginRenderer };
    }) => {
      const [svg, setSvg] = createSignal<string | null>(null);
      const [error, setError] = createSignal<string | null>(null);
      let containerRef: HTMLDivElement | undefined;
      let renderToken = 0;

      createEffect(() => {
        const content = props.diagram.content.trim();
        const token = (renderToken += 1);
        setSvg(null);
        setError(null);

        if (!content) {
          setError("Unable to render diagram preview.");
          return;
        }

        void (async () => {
          try {
            const engine = ensureMermaid();
            const result = await engine.render(
              `mermaid-${makeRandomId()}`,
              content
            );
            if (token !== renderToken) return;
            setSvg(result.svg ?? "");
            if (result.bindFunctions && containerRef) {
              Promise.resolve().then(() => {
                if (token !== renderToken) return;
                result.bindFunctions?.(containerRef);
              });
            }
          } catch {
            if (token !== renderToken) return;
            setSvg(null);
            setError("Unable to render diagram preview.");
          }
        })();
      });

      return (
        <div class="block-renderer block-renderer--diagram">
          <div class="block-renderer__title">Diagram preview</div>
          <div class="block-renderer__meta">
            {props.diagram.renderer.title} · {props.diagram.lang}
          </div>
          <div class="block-renderer__diagram">
            <Show
              when={svg()}
              fallback={
                <Show
                  when={error()}
                  fallback={
                    <div class="diagram-loading">Rendering diagram...</div>
                  }
                >
                  <div class="diagram-error">{error()}</div>
                </Show>
              }
            >
              {(value) => (
                <div
                  ref={containerRef}
                  class="diagram-svg"
                  innerHTML={value() ?? ""}
                />
              )}
            </Show>
          </div>
          <pre class="block-renderer__content">
            <code>{props.diagram.content}</code>
          </pre>
        </div>
      );
    };

    const renderMarkdownDisplay = (text: string): JSX.Element => {
      const list = parseMarkdownList(text);
      if (list) {
        const items = (
          <For each={list.items}>
            {(item) => <li>{renderInlineMarkdown(item)}</li>}
          </For>
        );
        if (list.type === "ol") {
          return <ol class="markdown-list">{items}</ol>;
        }
        return <ul class="markdown-list">{items}</ul>;
      }
      return <span>{renderInlineMarkdown(text)}</span>;
    };

    const requestRename = () => {
      const currentTitle = renameTitle().trim() || props.title;
      const nextTitle = prompt("Rename page", currentTitle);
      if (nextTitle === null) return;
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === currentTitle) return;
      setRenameTitle(trimmed);
      void renamePage();
    };

    return (
      <section class="editor-pane">
        <div class="editor-pane__header">
          <div class="editor-pane__title-group">
            <div class="editor-pane__title">{props.title}</div>
            <div class="editor-pane__count">{blocks.length} blocks</div>
          </div>
          <div class="editor-pane__actions">
            <button
              class="editor-pane__action"
              onClick={requestRename}
              disabled={pageBusy()}
            >
              {pageBusy() ? "Renaming..." : "Rename"}
            </button>
          </div>
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
                  const isEditing = () => focusedId() === block.id;
                  const displayContent = () => {
                    const code = codePreview();
                    if (code) {
                      return renderCodePreview(code, block.id);
                    }
                    const diagram = diagramPreview();
                    if (diagram) {
                      return <DiagramPreview diagram={diagram} />;
                    }
                    const trimmed = block.text.trim();
                    if (!trimmed) {
                      return (
                        <span class="block__placeholder">Write something...</span>
                      );
                    }
                    return renderMarkdownDisplay(block.text);
                  };
                  return (
                    <div
                      class={`block ${activeId() === block.id ? "is-active" : ""} ${
                        highlightedBlockId() === block.id ? "is-highlighted" : ""
                      }`}
                      ref={observeBlock}
                      data-block-id={block.id}
                      style={{
                        "margin-left": `${block.indent * 24}px`,
                        "--i": `${blockIndex()}`
                      }}
                    >
                      <div class="block__actions">
                        <button
                          class="block__action"
                          onClick={() => addReviewFromBlock(block)}
                          title="Add to review"
                          aria-label="Add to review"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                        <button
                          class="block__action"
                          onClick={() => linkToPageFromBlock(block, blockIndex())}
                          title="Link to page"
                          aria-label="Link to page"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </button>
                        <button
                          class="block__action"
                          onClick={() => duplicateBlockAt(blockIndex())}
                          title="Duplicate block"
                          aria-label="Duplicate block"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <rect x="2" y="2" width="13" height="13" rx="2" />
                          </svg>
                        </button>
                      </div>
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
                          style={{ display: isEditing() ? "block" : "none" }}
                          aria-hidden={!isEditing()}
                          onFocus={() => {
                            setActiveId(block.id);
                            setFocusedId(block.id);
                          }}
                          onBlur={(event) => {
                            storeSelection(block.id, event.currentTarget, true);
                            setFocusedId(null);
                            if (slashMenu().open && slashMenu().blockId === block.id) {
                              window.setTimeout(() => {
                                closeSlashMenu();
                              }, 0);
                            }
                            if (
                              wikilinkMenu().open &&
                              wikilinkMenu().blockId === block.id
                            ) {
                              window.setTimeout(() => {
                                closeWikilinkMenu();
                              }, 0);
                            }
                          }}
                          onInput={(event) => {
                            recordLatency("input");
                            setBlocks(blockIndex(), "text", event.currentTarget.value);
                            scheduleSave();
                            storeSelection(block.id, event.currentTarget);
                            const value = event.currentTarget.value;
                            const slashIndex = value.lastIndexOf("/");
                            const isSlash = slashIndex === value.length - 1;
                            if (isSlash) {
                              openSlashMenu(
                                block,
                                blockIndex(),
                                event.currentTarget,
                                slashIndex
                              );
                            } else if (
                              slashMenu().open &&
                              slashMenu().blockId === block.id
                            ) {
                              closeSlashMenu();
                            }
                            updateWikilinkMenu(
                              block,
                              blockIndex(),
                              event.currentTarget
                            );
                          }}
                          onKeyDown={(event) => handleKeyDown(block, blockIndex(), event)}
                          onKeyUp={(event) => {
                            storeSelection(block.id, event.currentTarget);
                            if (event.key === "/") {
                              const value = event.currentTarget.value;
                              const slashIndex = value.lastIndexOf("/");
                              const isSlash = slashIndex === value.length - 1;
                              if (isSlash) {
                                openSlashMenu(
                                  block,
                                  blockIndex(),
                                  event.currentTarget,
                                  slashIndex
                                );
                              }
                            }
                          }}
                          onSelect={(event) => storeSelection(block.id, event.currentTarget)}
                        />
                        <div
                          class="block__display"
                          style={{ display: isEditing() ? "none" : "block" }}
                          onClick={() => {
                            const preserve =
                              activeId() === block.id &&
                              caretPositions.has(block.id);
                            focusBlock(block.id, preserve ? "preserve" : "end");
                          }}
                        >
                          {displayContent()}
                        </div>
                        <Show when={isEditing() && codePreview()}>
                          {(preview) => renderCodePreview(preview(), block.id)}
                        </Show>
                        <Show when={isEditing() && diagramPreview()}>
                          {(preview) => (
                            <DiagramPreview diagram={preview()} />
                          )}
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
          <Show when={slashMenu().open && slashMenu().position}>
            {(position) => (
              <div
                class="slash-menu"
                style={{
                  left: `${position().x}px`,
                  top: `${position().y}px`
                }}
              >
                <div class="slash-menu__title">Commands</div>
                <div class="slash-menu__list">
                  <For each={SLASH_COMMANDS}>
                    {(command) => (
                      <button
                        class="slash-menu__item"
                        onClick={() => applySlashCommand(command.id)}
                        type="button"
                      >
                        {command.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>
          <Show when={wikilinkMenu().open && wikilinkMenu().position}>
            {(position) => (
              <div
                class="wikilink-menu"
                role="listbox"
                aria-label="Wikilink suggestions"
                style={{
                  left: `${position().x}px`,
                  top: `${position().y}px`
                }}
              >
                <div class="wikilink-menu__title">Link suggestions</div>
                <div class="wikilink-menu__list">
                  <For each={wikilinkMatches()}>
                    {(page) => {
                      const label = page.title || "Untitled";
                      const insertTitle = page.title || page.uid;
                      return (
                        <button
                          class="wikilink-menu__item"
                          type="button"
                          aria-label={label}
                          onClick={() => applyWikilinkSuggestion(insertTitle)}
                        >
                          <span class="wikilink-menu__label">{label}</span>
                          <Show
                            when={
                              resolvePageUid(page.uid) ===
                              resolvePageUid(activePageUid())
                            }
                          >
                            <span class="wikilink-menu__meta">Current</span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                  <Show when={wikilinkCreateLabel()}>
                    {(label) => (
                      <button
                        class="wikilink-menu__item wikilink-menu__item--create"
                        type="button"
                        onClick={() =>
                          applyWikilinkSuggestion(wikilinkQuery(), true)
                        }
                      >
                        {label()}
                      </button>
                    )}
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <Show when={linkPreview().open && linkPreview().position}>
            {(position) => (
              <div
                class="wikilink-preview"
                role="dialog"
                aria-label="Link preview"
                style={{
                  left: `${position().x}px`,
                  top: `${position().y}px`
                }}
                onMouseEnter={() => cancelLinkPreviewClose()}
                onMouseLeave={() => scheduleLinkPreviewClose()}
              >
                <div class="wikilink-preview__header">
                  <div class="wikilink-preview__title">
                    {linkPreview().title || "Untitled"}
                  </div>
                  <button
                    class="wikilink-preview__open"
                    type="button"
                    onClick={() => void openPageByTitle(linkPreview().title)}
                  >
                    Open
                  </button>
                </div>
                <div class="wikilink-preview__body">
                  <Show
                    when={!linkPreview().loading}
                    fallback={
                      <div class="wikilink-preview__loading">
                        Loading preview...
                      </div>
                    }
                  >
                    <Show
                      when={linkPreview().blocks.length > 0}
                      fallback={
                        <div class="wikilink-preview__empty">
                          No content yet.
                        </div>
                      }
                    >
                      <For each={linkPreview().blocks}>
                        {(blockText) => (
                          <div class="wikilink-preview__block">{blockText}</div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>
            )}
          </Show>
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
          <button
            class="topbar__sidebar-toggle"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>

        <nav class="mode-switch">
          <button
            class={`mode-switch__button ${mode() === "quick-capture" ? "is-active" : ""}`}
            onClick={() => setMode("quick-capture")}
          >
            Capture
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
          <button
            class={`mode-switch__button ${mode() === "viewer" ? "is-active" : ""}`}
            onClick={() => setMode("viewer")}
          >
            Viewer
          </button>
        </nav>

        <div class="topbar__right">
          <span class={`topbar__sync-indicator ${syncStatus().state}`} title={syncStateDetail()}>
            <span class="topbar__sync-dot" />
            <span class="topbar__sync-label">{syncStateLabel()}</span>
          </span>
          <span
            class={`topbar__autosave ${
              autosaveError() ? "is-error" : autosaved() ? "is-saved" : ""
            }`}
          >
            {autosaveError() ??
              (autosaved() ? `Saved ${autosaveStamp() ?? ""}` : "Saving...")}
          </span>
          <button
            class="topbar__settings"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <Show
        when={mode() === "editor"}
        fallback={
          <Show when={mode() === "viewer"} fallback={
            <section class="focus-panel">
              <SectionJump
                id={mode() === "quick-capture" ? "capture" : "review"}
                label={mode() === "quick-capture" ? "Capture" : "Review"}
              />
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
          }>
            <ViewerPane />
          </Show>
        }
      >
        <div class={`workspace ${sidebarOpen() ? "" : "sidebar-collapsed"}`}>
          <aside class={`sidebar ${sidebarOpen() ? "is-open" : ""}`}>
            <Show when={sidebarOpen()}>
              <SectionJump id="sidebar" label="Sidebar" />
            </Show>
            <div class="sidebar__header">
              <div class="sidebar__search">
                <svg class="sidebar__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16" y2="16" />
                </svg>
                <input
                  ref={searchInputRef}
                  class="sidebar__input"
                  type="search"
                  placeholder="Search..."
                  value={searchQuery()}
                  onInput={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitSearchTerm(event.currentTarget.value);
                    }
                  }}
                />
              </div>
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
              </div>
            </div>

            <div class="sidebar__content">
              <Show when={searchHistory().length > 0}>
                <div class="sidebar__section">
                  <div class="sidebar__section-header">
                    <span class="sidebar__section-title">Recent searches</span>
                    <span class="sidebar__section-count">
                      {searchHistory().length}
                    </span>
                  </div>
                  <div class="search-history">
                    <For each={searchHistory()}>
                      {(term) => (
                        <button
                          class="search-history__item"
                          aria-label={`Recent search ${term}`}
                          onClick={() => applySearchTerm(term)}
                        >
                          {term}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <Show when={searchQuery().trim().length > 0}>
                <div class="sidebar__section">
                  <div class="sidebar__section-header">
                    <span class="sidebar__section-title">Results</span>
                    <span class="sidebar__section-count">{filteredSearchResults().length}</span>
                  </div>
                  <div class="sidebar__results">
                    <Show
                      when={filteredSearchResults().length > 0}
                      fallback={<div class="sidebar__empty">No matches found</div>}
                    >
                      <For each={filteredSearchResults()}>
                        {(block) => (
                          <button
                            class="result"
                            onClick={() => {
                              setActiveId(block.id);
                              setJumpTarget({ id: block.id, caret: "start" });
                            }}
                          >
                            <div class="result__text">
                              {renderSearchHighlight(block.text || "Untitled")}
                            </div>
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </Show>

              <Show
                when={
                  searchQuery().trim().length === 0 &&
                  unlinkedReferences().length > 0
                }
              >
                <div class="sidebar__section">
                  <div class="sidebar__section-header">
                    <span class="sidebar__section-title">Unlinked references</span>
                    <span class="sidebar__section-count">
                      {unlinkedReferences().length}
                    </span>
                  </div>
                  <div class="unlinked-list">
                    <For each={unlinkedReferences()}>
                      {(ref) => (
                        <div class="unlinked-item">
                          <div class="unlinked-item__title">{ref.pageTitle}</div>
                          <div class="unlinked-item__snippet">{ref.snippet}</div>
                          <button
                            class="unlinked-item__action"
                            type="button"
                            onClick={() => linkUnlinkedReference(ref)}
                          >
                            Link it
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <div class="sidebar__section">
                <div class="sidebar__section-header">
                  <span class="sidebar__section-title">Pages</span>
                  <button
                    class="sidebar__section-action"
                    onClick={() => {
                      const title = prompt("New page title:");
                      if (title?.trim()) {
                        setNewPageTitle(title.trim());
                        void createPage();
                      }
                    }}
                    aria-label="Create new page"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                <Show when={pageMessage()}>
                  {(message) => <div class="page-message">{message()}</div>}
                </Show>
                <div class="page-list">
                  <Show
                    when={pages().length > 0}
                    fallback={<div class="page-list__empty">No pages yet</div>}
                  >
                    <For each={pages()}>
                      {(page) => (
                        <button
                          class={`page-item ${
                            page.uid === resolvePageUid(activePageUid())
                              ? "is-active"
                              : ""
                          }`}
                          onClick={() => switchPage(page.uid)}
                          aria-label={`Open ${page.title || "Untitled"}`}
                        >
                          <svg class="page-item__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14,2 14,8 20,8" />
                          </svg>
                          <div class="page-item__content">
                            <div class="page-item__title">
                              {page.title || "Untitled"}
                            </div>
                          </div>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </div>

            <div class="sidebar__footer">
              <span>{activeVault()?.name ?? "Default"}</span>
            </div>
          </aside>

          <main class={`main-pane ${backlinksOpen() ? "has-panel" : ""}`} role="main">
            <div class="main-pane__editor">
              <SectionJump id="editor" label="Editor" />
              <EditorPane title={pageTitle()} />
            </div>

            {/* Backlinks toggle button */}
            <button
              class={`backlinks-toggle ${backlinksOpen() ? "is-active" : ""} ${totalBacklinks() > 0 ? "has-links" : ""}`}
              onClick={() => setBacklinksOpen(prev => !prev)}
              aria-label={backlinksOpen() ? "Hide backlinks" : "Show backlinks"}
              title={`${totalBacklinks()} backlinks`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <Show when={totalBacklinks() > 0}>
                <span class="backlinks-toggle__badge">{totalBacklinks()}</span>
              </Show>
            </button>

            {/* Backlinks side panel */}
            <aside class={`backlinks-panel ${backlinksOpen() ? "is-open" : ""}`}>
              <Show when={backlinksOpen()}>
                <SectionJump id="backlinks" label="Backlinks" />
              </Show>
              <div class="backlinks-panel__header">
                <div class="backlinks-panel__title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Backlinks
                </div>
                <button class="backlinks-panel__close" onClick={() => setBacklinksOpen(false)} aria-label="Close backlinks">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div class="backlinks-panel__body">
                <Show
                  when={
                    activePageBacklinks().length > 0 ||
                    (activeBlock() && activeBacklinks().length > 0)
                  }
                  fallback={
                    <div class="backlinks-panel__empty">
                      <div class="backlinks-panel__empty-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                      </div>
                      <p>No backlinks yet</p>
                      <span>Use <code>((block-id))</code> or <code>[[Page]]</code> to create links</span>
                    </div>
                  }
                >
                  <Show when={activePageBacklinks().length > 0}>
                    <div class="backlinks-panel__section">
                      <div class="backlinks-panel__section-title">Page backlinks</div>
                      <div class="backlinks-panel__context">
                        Linked to page <strong>{pageTitle()}</strong>
                      </div>
                      <div class="backlinks-panel__groups">
                        <For each={groupedPageBacklinks()}>
                          {(group) => (
                            <div class="backlink-group">
                              <div class="backlink-group__header">
                                <div class="backlink-group__title">
                                  {group.title}
                                </div>
                                <Show when={supportsMultiPane}>
                                  <button
                                    class="backlink-group__action"
                                    type="button"
                                    onClick={() =>
                                      void openPageBacklinkInPane(group.entries[0])
                                    }
                                  >
                                    Open in pane
                                  </button>
                                </Show>
                              </div>
                              <div class="backlink-group__list">
                                <For each={group.entries}>
                                  {(entry) => (
                                    <button
                                      class="backlink-item"
                                      onClick={() => void openPageBacklink(entry)}
                                    >
                                      <div class="backlink-item__text">
                                        {formatBacklinkSnippet(entry.text || "Untitled")}
                                      </div>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={activeBlock()}>
                    {(block) => (
                      <Show when={activeBacklinks().length > 0}>
                        <div class="backlinks-panel__section">
                          <div class="backlinks-panel__section-title">Block backlinks</div>
                          <div class="backlinks-panel__context">
                            Linked to <strong>{block().text.slice(0, 40) || "this block"}{block().text.length > 40 ? "..." : ""}</strong>
                          </div>
                          <div class="backlinks-panel__list">
                            <For each={activeBacklinks()}>
                              {(entry) => (
                                <button
                                  class="backlink-item"
                                  onClick={() => {
                                    setActiveId(entry.id);
                                    setJumpTarget({ id: entry.id, caret: "start" });
                                  }}
                                >
                                  <div class="backlink-item__text">
                                    {formatBacklinkSnippet(entry.text || "Untitled")}
                                  </div>
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    )}
                  </Show>
                </Show>
              </div>
            </aside>
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
          </main>
        </div>
      </Show>

      {/* Command Palette */}
      <Show when={paletteOpen()}>
        <div
          class="modal-backdrop"
          onClick={(event) =>
            event.target === event.currentTarget && closeCommandPalette()
          }
        >
          <div
            class="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="command-palette__title">Command palette</div>
            <input
              ref={(el) => {
                paletteInputRef = el;
                if (paletteOpen()) {
                  queueMicrotask(() => el.focus());
                }
              }}
              class="command-palette__input"
              type="search"
              placeholder="Search commands..."
              value={paletteQuery()}
              onInput={(event) => setPaletteQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  movePaletteIndex(1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  movePaletteIndex(-1);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runPaletteCommand(
                    filteredPaletteCommands()[paletteIndex()]
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeCommandPalette();
                }
              }}
            />
            <div class="command-palette__list" role="listbox" aria-label="Command results">
              <Show
                when={filteredPaletteCommands().length > 0}
                fallback={<div class="command-palette__empty">No matches</div>}
              >
                <For each={filteredPaletteCommands()}>
                  {(command, index) => (
                    <button
                      class={`command-palette__item ${
                        index() === paletteIndex() ? "is-active" : ""
                      }`}
                      type="button"
                      role="option"
                      aria-selected={index() === paletteIndex()}
                      onMouseEnter={() => setPaletteIndex(index())}
                      onClick={() => void runPaletteCommand(command)}
                    >
                      <span>{command.label}</span>
                      <Show when={command.hint}>
                        {(hint) => (
                          <span class="command-palette__hint">{hint()}</span>
                        )}
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Settings Modal */}
      <Show when={settingsOpen()}>
        <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}>
          <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div class="settings-modal__header">
              <h2 id="settings-title">Settings</h2>
              <button class="settings-modal__close" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="settings-modal__body">
              <nav class="settings-nav">
                <button class={`settings-nav__item ${settingsTab() === "general" ? "is-active" : ""}`} onClick={() => setSettingsTab("general")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                  General
                </button>
                <button class={`settings-nav__item ${settingsTab() === "vault" ? "is-active" : ""}`} onClick={() => setSettingsTab("vault")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Vault
                </button>
                <button class={`settings-nav__item ${settingsTab() === "sync" ? "is-active" : ""}`} onClick={() => setSettingsTab("sync")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  Sync
                </button>
                <button class={`settings-nav__item ${settingsTab() === "plugins" ? "is-active" : ""}`} onClick={() => setSettingsTab("plugins")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                  Plugins
                </button>
                <button class={`settings-nav__item ${settingsTab() === "permissions" ? "is-active" : ""}`} onClick={() => setSettingsTab("permissions")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v5c0 5-3.5 9-7 9s-7-4-7-9V7l7-4z" /><path d="M9 12l2 2 4-4" /></svg>
                  Permissions
                </button>
                <button class={`settings-nav__item ${settingsTab() === "import" ? "is-active" : ""}`} onClick={() => setSettingsTab("import")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  Import
                </button>
              </nav>
              <div class="settings-content">
                <Show when={settingsTab() === "general"}>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Typography</h3>
                    <p class="settings-section__desc">Adjust the text size across the interface.</p>
                    <div class="settings-slider">
                      <div class="settings-slider__header">
                        <label class="settings-label">Text size</label>
                        <span class="settings-value">{Math.round(typeScale() * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        class="settings-slider__input"
                        min={TYPE_SCALE_MIN}
                        max={TYPE_SCALE_MAX}
                        step={TYPE_SCALE_STEP}
                        value={typeScale()}
                        onInput={(e) => setTypeScale(parseFloat(e.currentTarget.value))}
                      />
                      <div
                        class="settings-slider__labels"
                        style={{ "--default-position": TYPE_SCALE_DEFAULT_POSITION }}
                      >
                        <span class="settings-slider__label is-min">Compact</span>
                        <span class="settings-slider__label is-default">Default</span>
                        <span class="settings-slider__label is-max">Large</span>
                      </div>
                    </div>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Appearance</h3>
                    <p class="settings-section__desc">Sandpaper follows your system color scheme.</p>
                    <div class="settings-row">
                      <label class="settings-label">Current vault</label>
                      <span class="settings-value">{activeVault()?.name ?? "Default"}</span>
                    </div>
                  </div>
                </Show>
                <Show when={settingsTab() === "vault"}>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Active Vault</h3>
                    <select class="settings-select" value={activeVault()?.id ?? ""} onChange={(e) => applyActiveVault(e.currentTarget.value)}>
                      <For each={vaults()}>{(vault) => <option value={vault.id}>{vault.name}</option>}</For>
                    </select>
                    <button class="settings-action" onClick={() => setVaultFormOpen((p) => !p)}>
                      {vaultFormOpen() ? "Cancel" : "New vault"}
                    </button>
                    <Show when={vaultFormOpen()}>
                      <div class="settings-form">
                        <input class="settings-input" type="text" placeholder="Vault name" value={newVaultName()} onInput={(e) => setNewVaultName(e.currentTarget.value)} />
                        <div class="settings-file-row">
                          <input class="settings-input" type="text" placeholder="Vault path" value={newVaultPath()} onInput={(e) => setNewVaultPath(e.currentTarget.value)} />
                          <button class="settings-action" type="button" onClick={openVaultFolderPicker}>
                            Browse
                          </button>
                        </div>
                        <input
                          ref={(el) => {
                            vaultFolderPickerRef = el;
                            el.setAttribute("webkitdirectory", "");
                            el.setAttribute("directory", "");
                          }}
                          data-testid="vault-folder-picker"
                          class="settings-file-input"
                          type="file"
                          onChange={handleVaultFolderPick}
                        />
                        <button class="settings-action is-primary" onClick={createVault}>Create vault</button>
                      </div>
                    </Show>
                    <div class="settings-row">
                      <label class="settings-label">Shadow write queue</label>
                      <span
                        class={`settings-value ${
                          shadowPendingCount() > 0 ? "is-warning" : "is-success"
                        }`}
                      >
                        {shadowPendingCount()} pending
                      </span>
                    </div>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Encryption Key</h3>
                    <p class="settings-section__desc">{vaultKeyStatus().configured ? `Configured (${vaultKeyStatus().kdf ?? "pbkdf2-sha256"})` : "Set a passphrase to enable E2E encryption."}</p>
                    <input class="settings-input" type="password" placeholder="Passphrase" value={vaultPassphrase()} onInput={(e) => setVaultPassphrase(e.currentTarget.value)} />
                    <div class="settings-actions">
                      <button class="settings-action is-primary" disabled={vaultKeyBusy() || !vaultPassphrase().trim()} onClick={setVaultKey}>
                        {vaultKeyBusy() ? "Deriving..." : "Set passphrase"}
                      </button>
                      <button class="settings-action" onClick={() => setVaultPassphrase("")}>Clear</button>
                    </div>
                    <Show when={vaultKeyMessage()}><div class="settings-message">{vaultKeyMessage()}</div></Show>
                  </div>
                </Show>
                <Show when={settingsTab() === "sync"}>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Connection</h3>
                    <div class="settings-status">
                      <span class={`settings-status__dot ${syncStatus().state}`} />
                      <span class="settings-status__label">{syncStateLabel()}</span>
                    </div>
                    <p class="settings-section__desc">{syncStateDetail()}</p>
                    <input class="settings-input" type="text" placeholder="Sync server URL" value={syncServerUrl()} onInput={(e) => setSyncServerUrl(e.currentTarget.value)} />
                    <input class="settings-input" type="text" placeholder="Vault ID (optional)" value={syncVaultIdInput()} onInput={(e) => setSyncVaultIdInput(e.currentTarget.value)} />
                    <input class="settings-input" type="text" placeholder="Device ID (optional)" value={syncDeviceIdInput()} onInput={(e) => setSyncDeviceIdInput(e.currentTarget.value)} />
                    <div class="settings-actions">
                      <button class="settings-action is-primary" disabled={!isTauri() || syncBusy() || !vaultKeyStatus().configured || !syncServerUrl().trim()} onClick={connectSync}>
                        {syncBusy() ? "Connecting..." : "Connect"}
                      </button>
                      <button class="settings-action" disabled={!isTauri() || syncBusy() || !syncConnected()} onClick={syncNow}>Sync now</button>
                    </div>
                    <Show when={syncMessage()}><div class="settings-message">{syncMessage()}</div></Show>
                  </div>
                  <Show when={syncConnected()}>
                    <div class="settings-section">
                      <h3 class="settings-section__title">Statistics</h3>
                      <div class="settings-stats">
                        <div class="settings-stat"><span class="settings-stat__value">{syncStatus().pending_ops}</span><span class="settings-stat__label">Queue</span></div>
                        <div class="settings-stat"><span class="settings-stat__value">{syncStatus().last_push_count}</span><span class="settings-stat__label">Pushed</span></div>
                        <div class="settings-stat"><span class="settings-stat__value">{syncStatus().last_pull_count}</span><span class="settings-stat__label">Pulled</span></div>
                        <div class="settings-stat"><span class="settings-stat__value">{syncStatus().last_apply_count}</span><span class="settings-stat__label">Applied</span></div>
                      </div>
                      <div class="settings-row"><label class="settings-label">Vault ID</label><code class="settings-code">{syncConfig()?.vault_id}</code></div>
                      <div class="settings-row"><label class="settings-label">Device ID</label><code class="settings-code">{syncConfig()?.device_id}</code></div>
                    </div>
                    <div class="settings-section">
                      <div class="settings-section__header">
                        <h3 class="settings-section__title">Activity log</h3>
                        <button
                          class="settings-action"
                          onClick={copySyncLog}
                          disabled={syncLog().length === 0}
                        >
                          Copy log
                        </button>
                      </div>
                      <Show
                        when={syncLog().length > 0}
                        fallback={
                          <p class="settings-section__desc">
                            No sync activity yet.
                          </p>
                        }
                      >
                        <div class="sync-log">
                          <For each={[...syncLog()].reverse()}>
                            {(entry) => (
                              <div
                                class={`sync-log__row ${
                                  entry.status === "error" ? "is-error" : ""
                                }`}
                              >
                                <span class="sync-log__time">{entry.at}</span>
                                <span class={`sync-log__action is-${entry.action}`}>
                                  {entry.action}
                                </span>
                                <span class="sync-log__count">
                                  {entry.count}
                                </span>
                                <Show when={entry.detail}>
                                  <span class="sync-log__detail">
                                    {entry.detail}
                                  </span>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                    <Show when={syncConflicts().length > 0}>
                      <div class="settings-section">
                        <div class="settings-section__header">
                          <h3 class="settings-section__title">Sync conflicts</h3>
                          <span class="sync-conflict-count">
                            {syncConflicts().length} open
                          </span>
                        </div>
                        <p class="settings-section__desc">
                          Conflicting edits were detected during sync. Choose a
                          version or merge the text before continuing.
                        </p>
                        <SyncConflictDiagram />
                        <div class="sync-conflicts">
                          <For each={syncConflicts()}>
                            {(conflict) => (
                              <div class="sync-conflict">
                                <div class="sync-conflict__header">
                                  <div>
                                    <div class="sync-conflict__title">
                                      {getConflictPageTitle(conflict.page_uid)}
                                    </div>
                                    <div class="sync-conflict__meta">
                                      Block {conflict.block_uid}
                                    </div>
                                  </div>
                                </div>
                                <div class="sync-conflict__diff">
                                  <div class="sync-conflict__pane is-local">
                                    <div class="sync-conflict__label">
                                      Local
                                    </div>
                                    <pre class="sync-conflict__text">
                                      {conflict.local_text}
                                    </pre>
                                  </div>
                                  <div class="sync-conflict__pane is-remote">
                                    <div class="sync-conflict__label">
                                      Remote
                                    </div>
                                    <pre class="sync-conflict__text">
                                      {conflict.remote_text}
                                    </pre>
                                  </div>
                                </div>
                                <div class="sync-conflict__actions">
                                  <button
                                    class="settings-action"
                                    onClick={() =>
                                      void resolveSyncConflict(
                                        conflict,
                                        "local"
                                      )
                                    }
                                  >
                                    Use local
                                  </button>
                                  <button
                                    class="settings-action"
                                    onClick={() =>
                                      void resolveSyncConflict(
                                        conflict,
                                        "remote"
                                      )
                                    }
                                  >
                                    Use remote
                                  </button>
                                  <button
                                    class="settings-action is-primary"
                                    onClick={() =>
                                      startSyncConflictMerge(conflict)
                                    }
                                  >
                                    Merge
                                  </button>
                                </div>
                                <Show
                                  when={
                                    syncConflictMergeId() === conflict.op_id
                                  }
                                >
                                  <div class="sync-conflict__merge">
                                    <label class="sync-conflict__label">
                                      Merged
                                    </label>
                                    <textarea
                                      class="sync-conflict__textarea"
                                      value={
                                        syncConflictMergeDrafts[
                                          conflict.op_id
                                        ] ?? ""
                                      }
                                      onInput={(event) =>
                                        setSyncConflictMergeDrafts(
                                          conflict.op_id,
                                          event.currentTarget.value
                                        )
                                      }
                                    />
                                    <div class="sync-conflict__actions">
                                      <button
                                        class="settings-action is-primary"
                                        onClick={() =>
                                          void resolveSyncConflict(
                                            conflict,
                                            "merge",
                                            syncConflictMergeDrafts[
                                              conflict.op_id
                                            ] ?? ""
                                          )
                                        }
                                      >
                                        Apply merge
                                      </button>
                                      <button
                                        class="settings-action"
                                        onClick={cancelSyncConflictMerge}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </Show>
                </Show>
                <Show when={settingsTab() === "plugins"}>
                  <Show when={pluginError()}>
                    <div class="settings-banner is-error">
                      <div>
                        <div class="settings-banner__title">Plugin error</div>
                        <div class="settings-banner__message">{pluginError()}</div>
                      </div>
                      <button
                        class="settings-action"
                        onClick={loadPluginRuntime}
                        disabled={pluginBusy()}
                      >
                        {pluginBusy() ? "Reloading..." : "Reload plugins"}
                      </button>
                    </div>
                  </Show>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Installed Plugins</h3>
                    <Show when={plugins().length > 0} fallback={<p class="settings-section__desc">No plugins installed.</p>}>
                      <For each={plugins()}>{(plugin) => (
                        <div class={`settings-plugin ${plugin.enabled ? "" : "is-disabled"}`}>
                          <div class="settings-plugin__info">
                            <span class="settings-plugin__name">{plugin.name}</span>
                            <span class="settings-plugin__version">{plugin.version}</span>
                          </div>
                          <Show when={plugin.description}><p class="settings-plugin__desc">{plugin.description}</p></Show>
                          <Show when={plugin.missing_permissions.length > 0}>
                            <div class="settings-plugin__permissions">
                              <For each={plugin.missing_permissions}>{(perm) => (
                                <button class="settings-action" onClick={() => requestGrantPermission(plugin, perm)}>Grant {perm}</button>
                              )}</For>
                            </div>
                          </Show>
                        </div>
                      )}</For>
                    </Show>
                    <button class="settings-action is-primary" onClick={loadPluginRuntime} disabled={pluginBusy()}>
                      {pluginBusy() ? "Loading..." : "Reload plugins"}
                    </button>
                    <Show when={commandStatus()}><div class="settings-message is-success">{commandStatus()}</div></Show>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Plugin Commands</h3>
                    <Show
                      when={(pluginStatus()?.commands ?? []).length > 0}
                      fallback={<p class="settings-section__desc">No plugin commands available.</p>}
                    >
                      <For each={pluginStatus()?.commands ?? []}>
                        {(command) => (
                          <div class="settings-row">
                            <div>
                              <div class="settings-value">{command.title}</div>
                              <Show when={command.description}>
                                <div class="settings-label">{command.description}</div>
                              </Show>
                            </div>
                            <button
                              class="settings-action"
                              onClick={() => runPluginCommand(command)}
                              disabled={pluginBusy()}
                            >
                              Run
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Plugin Panels</h3>
                    <Show
                      when={(pluginStatus()?.panels ?? []).length > 0}
                      fallback={<p class="settings-section__desc">No plugin panels available.</p>}
                    >
                      <For each={pluginStatus()?.panels ?? []}>
                        {(panel) => (
                          <div class="settings-row">
                            <div>
                              <div class="settings-value">{panel.title}</div>
                              <Show when={panel.location}>
                                <div class="settings-label">{panel.location}</div>
                              </Show>
                            </div>
                            <button
                              class="settings-action"
                              onClick={() => openPanel(panel)}
                              disabled={pluginBusy()}
                            >
                              Open
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
                <Show when={settingsTab() === "permissions"}>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Permission Audit</h3>
                    <p class="settings-section__desc">
                      Review required permissions, missing grants, and unused grants.
                    </p>
                    <div class="settings-permission-legend">
                      <span class="settings-permission is-granted">Granted</span>
                      <span class="settings-permission is-missing">Missing</span>
                      <span class="settings-permission is-unused">Unused</span>
                    </div>
                    <Show
                      when={plugins().length > 0}
                      fallback={<p class="settings-section__desc">No plugins installed.</p>}
                    >
                      <For each={plugins()}>
                        {(plugin) => {
                          const missing = plugin.missing_permissions;
                          const unused = plugin.granted_permissions.filter(
                            (perm) => !plugin.permissions.includes(perm)
                          );
                          const orderedPermissions = [
                            ...plugin.permissions,
                            ...unused
                          ];
                          const showPermissions = orderedPermissions.length > 0;
                          return (
                            <div class="settings-permission-card">
                              <div class="settings-permission-header">
                                <span class="settings-permission-name">
                                  {plugin.name}
                                </span>
                                <span class="settings-permission-version">
                                  {plugin.version}
                                </span>
                              </div>
                              <Show when={plugin.description}>
                                <p class="settings-section__desc">
                                  {plugin.description}
                                </p>
                              </Show>
                              <Show
                                when={showPermissions}
                                fallback={
                                  <p class="settings-section__desc">
                                    No permissions requested.
                                  </p>
                                }
                              >
                                <div class="settings-permission-list">
                                  <For each={orderedPermissions}>
                                    {(perm) => (
                                      <span
                                        class={`settings-permission ${
                                          missing.includes(perm)
                                            ? "is-missing"
                                            : unused.includes(perm)
                                              ? "is-unused"
                                              : "is-granted"
                                        }`}
                                      >
                                        {perm}
                                      </span>
                                    )}
                                  </For>
                                </div>
                              </Show>
                              <Show when={missing.length > 0}>
                                <p class="settings-permission-note is-missing">
                                  Missing: {missing.join(", ")}
                                </p>
                              </Show>
                              <Show when={unused.length > 0}>
                                <p class="settings-permission-note is-unused">
                                  Unused grants: {unused.join(", ")}
                                </p>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </Show>
                <Show when={settingsTab() === "import"}>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Import Markdown</h3>
                    <p class="settings-section__desc">Paste shadow Markdown to create or update a page.</p>
                    <textarea class="settings-textarea" rows={5} placeholder="Paste markdown here..." value={importText()} onInput={(e) => setImportText(e.currentTarget.value)} />
                    <div class="settings-actions">
                      <button class="settings-action" type="button" onClick={openMarkdownFilePicker}>
                        Choose file
                      </button>
                      <button class="settings-action is-primary" onClick={importMarkdown} disabled={importing()}>{importing() ? "Importing..." : "Import"}</button>
                      <button class="settings-action" onClick={() => { setImportText(""); setImportStatus(null); }}>Clear</button>
                    </div>
                    <input
                      ref={(el) => {
                        markdownFilePickerRef = el;
                      }}
                      data-testid="markdown-file-picker"
                      class="settings-file-input"
                      type="file"
                      accept=".md,text/markdown"
                      onChange={(event) => void handleMarkdownFilePick(event)}
                    />
                    <Show when={importStatus()}>{(s) => <div class={`settings-message ${s().state === "success" ? "is-success" : "is-error"}`}>{s().message}</div>}</Show>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Export Markdown</h3>
                    <p class="settings-section__desc">Export all pages as read-only Markdown with stable block IDs.</p>
                    <button class="settings-action is-primary" onClick={exportMarkdown} disabled={exporting()}>{exporting() ? "Exporting..." : "Export all pages"}</button>
                    <Show when={exportStatus()}>{(s) => <div class={`settings-message ${s().state === "success" ? "is-success" : "is-error"}`}>{s().message}</div>}</Show>
                    <Show when={exportStatus()?.preview}>{(preview) => <pre class="settings-preview"><code>{preview()}</code></pre>}</Show>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Offline backup</h3>
                    <p class="settings-section__desc">Export a zip archive with pages and assets for offline restore.</p>
                    <button
                      class="settings-action is-primary"
                      onClick={exportOfflineArchive}
                      disabled={offlineExporting()}
                    >
                      {offlineExporting() ? "Exporting..." : "Export offline archive"}
                    </button>
                    <Show when={offlineExportStatus()}>
                      {(s) => (
                        <div
                          class={`settings-message ${
                            s().state === "success" ? "is-success" : "is-error"
                          }`}
                        >
                          {s().message}
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Offline restore</h3>
                    <p class="settings-section__desc">Import a zip archive to restore pages and assets.</p>
                    <div class="settings-actions">
                      <button class="settings-action" type="button" onClick={openOfflineArchivePicker}>
                        Choose archive
                      </button>
                      <button
                        class="settings-action is-primary"
                        onClick={importOfflineArchive}
                        disabled={offlineImporting()}
                      >
                        {offlineImporting() ? "Importing..." : "Import archive"}
                      </button>
                      <Show when={offlineImportFile()}>
                        {(file) => (
                          <span class="settings-value">
                            {file().name}
                          </span>
                        )}
                      </Show>
                    </div>
                    <input
                      ref={(el) => {
                        offlineArchivePickerRef = el;
                      }}
                      data-testid="offline-archive-picker"
                      class="settings-file-input"
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(event) => handleOfflineArchivePick(event)}
                    />
                    <Show when={offlineImportStatus()}>
                      {(s) => (
                        <div
                          class={`settings-message ${
                            s().state === "success" ? "is-success" : "is-error"
                          }`}
                        >
                          {s().message}
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

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

export default App;
