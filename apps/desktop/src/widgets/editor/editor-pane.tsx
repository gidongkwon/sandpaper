import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
  type Setter
} from "solid-js";
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Block, BlockType } from "../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../../entities/page/model/page-types";
import type { PageId } from "../../shared/model/id-types";
import type { PluginRenderer } from "../../entities/plugin/model/plugin-types";
import type { CodeFence } from "../../shared/model/markdown-types";
import type { CaretPosition } from "../../shared/model/position";
import { LinkPreview } from "../../features/editor/ui/link-preview";
import { SlashMenu } from "../../features/editor/ui/slash-menu";
import { WikilinkMenu } from "../../features/editor/ui/wikilink-menu";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { copyToClipboard } from "../../shared/lib/clipboard/copy-to-clipboard";
import { DIAGRAM_LANGS, ensureMermaid } from "../../shared/lib/diagram/mermaid";
import { makeRandomId } from "../../shared/lib/id/id-factory";
import { PluginBlockPreview } from "../plugins/plugin-block-preview";
import {
  INLINE_MARKDOWN_PATTERN,
  parseInlineFence,
  parseInlineLinkToken,
  parseMarkdownList,
  parseWikilinkToken
} from "../../shared/lib/markdown/inline-parser";
import { normalizePageUid } from "../../shared/lib/page/normalize-page-uid";
import { getSafeLocalStorage } from "../../shared/lib/storage/safe-local-storage";
import { getCaretPosition } from "../../shared/lib/textarea/get-caret-position";
import { getVirtualRange } from "../../shared/lib/virtual-list/virtual-list";
import {
  cleanTextForBlockType,
  extractImageSource,
  isTodoChecked,
  resolveRenderBlockType,
  resolveBlockType,
  toggleTodoText
} from "../../shared/lib/blocks/block-type-utils";

type JumpTarget = {
  id: string;
  caret: "start" | "end" | "preserve";
};

type SlashMenuState = {
  open: boolean;
  blockId: string | null;
  blockIndex: number;
  slashIndex: number;
  position: CaretPosition | null;
};

type WikilinkMenuState = {
  open: boolean;
  blockId: string | null;
  blockIndex: number;
  rangeStart: number;
  rangeEnd: number;
  hasClosing: boolean;
  query: string;
  position: CaretPosition | null;
};

type LinkPreviewState = {
  open: boolean;
  position: CaretPosition | null;
  pageUid: PageId | null;
  title: string;
  blocks: string[];
  loading: boolean;
};

type OutlineItem = {
  block: Block;
  index: number;
  indent: number;
  parentIndex: number | null;
  hasChildren: boolean;
  collapsed: boolean;
  hidden: boolean;
};

type OutlineState = {
  items: OutlineItem[];
  visible: OutlineItem[];
  visibleToActual: number[];
  actualToVisible: number[];
};

type BlockDropHint = {
  blockId: string;
  position: "before" | "after";
  desiredRootIndent?: number;
};

type EditorPaneProps = {
  blocks: Block[];
  setBlocks: SetStoreFunction<Block[]>;
  activeId: Accessor<string | null>;
  setActiveId: Setter<string | null>;
  focusedId: Accessor<string | null>;
  setFocusedId: Setter<string | null>;
  highlightedBlockId: Accessor<string | null>;
  jumpTarget: Accessor<JumpTarget | null>;
  setJumpTarget: Setter<JumpTarget | null>;
  createNewBlock: (
    text?: string,
    indent?: number,
    blockType?: BlockType
  ) => Block;
  scheduleSave: () => void;
  recordLatency: (label: string) => void;
  addReviewItem: (id: string) => void | Promise<void>;
  pageBusy: Accessor<boolean>;
  renameTitle: Accessor<string>;
  setRenameTitle: Setter<string>;
  renamePage: () => void | Promise<void>;
  pages: Accessor<PageSummary[]>;
  activePageUid: Accessor<PageId>;
  resolvePageUid: (value: string) => PageId;
  setNewPageTitle: Setter<string>;
  createPage: () => void | Promise<void>;
  switchPage: (uid: PageId) => void | Promise<void>;
  createPageFromLink: (title: string) => void | Promise<void> | Promise<PageSummary | null>;
  isTauri: () => boolean;
  localPages: Record<PageId, LocalPageRecord>;
  saveLocalPageSnapshot: (pageUid: PageId, title: string, blocks: Block[]) => void;
  snapshotBlocks: (source: Block[]) => Block[];
  pageTitle: Accessor<string>;
  renderersByKind: Accessor<Map<string, PluginRenderer>>;
  blockRenderersByLang: Accessor<Map<string, PluginRenderer>>;
  perfEnabled: Accessor<boolean>;
  scrollMeter: { notifyScroll: () => void };
};

const ROW_HEIGHT = 44;
const OVERSCAN = 6;

export const EditorPane = (props: EditorPaneProps) => {
  // Props here are accessors/handlers; destructuring keeps the render readable without breaking reactivity.
  /* eslint-disable solid/reactivity */
  const blocks = props.blocks;
  const setBlocks = props.setBlocks;
  const activeId = props.activeId;
  const setActiveId = props.setActiveId;
  const focusedId = props.focusedId;
  const setFocusedId = props.setFocusedId;
  const highlightedBlockId = props.highlightedBlockId;
  const jumpTarget = props.jumpTarget;
  const setJumpTarget = props.setJumpTarget;
  const createNewBlock = props.createNewBlock;
  const scheduleSave = props.scheduleSave;
  const recordLatency = props.recordLatency;
  const pageBusy = props.pageBusy;
  const renameTitle = props.renameTitle;
  const setRenameTitle = props.setRenameTitle;
  const renamePage = props.renamePage;
  const pages = props.pages;
  const activePageUid = props.activePageUid;
  const resolvePageUid = props.resolvePageUid;
  const setNewPageTitle = props.setNewPageTitle;
  const createPage = props.createPage;
  const switchPage = props.switchPage;
  const createPageFromLink = props.createPageFromLink;
  const isTauri = props.isTauri;
  const localPages = props.localPages;
  const saveLocalPageSnapshot = props.saveLocalPageSnapshot;
  const snapshotBlocks = props.snapshotBlocks;
  const pageTitle = props.pageTitle;
  const renderersByKind = props.renderersByKind;
  const blockRenderersByLang = props.blockRenderersByLang;
  const perfEnabled = props.perfEnabled;
  const scrollMeter = props.scrollMeter;
  /* eslint-enable solid/reactivity */

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [copiedBlockId, setCopiedBlockId] = createSignal<string | null>(null);
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
  const [collapsedBlocks, setCollapsedBlocks] = createSignal<Set<string>>(
    new Set<string>()
  );
  const [outlineMenuOpen, setOutlineMenuOpen] = createSignal(false);
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [dialogMode, setDialogMode] = createSignal<"link" | "rename" | null>(
    null
  );
  const [dialogValue, setDialogValue] = createSignal("");
  const [dialogTarget, setDialogTarget] = createSignal<{
    id: string;
    index: number;
  } | null>(null);
  const [blockHeights, setBlockHeights] = createStore<Record<string, number>>(
    {}
  );
  const [selectionRange, setSelectionRange] = createSignal<{
    start: number;
    end: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  const [dragBox, setDragBox] = createSignal<{
    top: number;
    height: number;
  } | null>(null);
  const [draggedBlockId, setDraggedBlockId] = createSignal<string | null>(null);
  const [blockDropHint, setBlockDropHint] = createSignal<BlockDropHint | null>(
    null
  );
  const [columnDropTargetId, setColumnDropTargetId] = createSignal<string | null>(
    null
  );
  const [handleDragging, setHandleDragging] = createSignal(false);
  const supportsPointer =
    typeof window !== "undefined" && "PointerEvent" in window;
  const isMacPlatform =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const isMoveShortcut = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
    if (isMacPlatform) {
      return event.altKey && event.metaKey;
    }
    return event.altKey;
  };
  let selecting = false;
  let selectionAnchor = -1;
  let selectionPointerId: number | null = null;
  let dragStartClientY: number | null = null;
  let handleDragPointerId: number | null = null;
  const inputRefs = new Map<string, HTMLTextAreaElement>();
  const caretPositions = new Map<string, { start: number; end: number }>();
  const previewCache = new Map<string, { title: string; blocks: string[] }>();
  const IMAGE_EXTENSIONS = [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "svg",
    "bmp",
    "tif",
    "tiff",
    "ico"
  ] as const;
  let editorRef: HTMLDivElement | undefined;
  let copyTimeout: number | undefined;
  let previewCloseTimeout: number | undefined;

  const getBlockType = (block: Block) => resolveRenderBlockType(block);

  const effectiveViewport = createMemo(() =>
    viewportHeight() === 0 ? 560 : viewportHeight()
  );
  const storage = getSafeLocalStorage();
  const canUseStorage = storage !== null;
  const collapsedStorageKey = createMemo(
    () => `sandpaper:outline:collapsed:${activePageUid()}`
  );
  const [collapsedKeyLoaded, setCollapsedKeyLoaded] = createSignal<
    string | null
  >(null);

  const loadCollapsedState = (key: string) => {
    if (!canUseStorage) return [];
    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  };

  const persistCollapsedState = (key: string, collapsed: Set<string>) => {
    if (!canUseStorage) return;
    try {
      storage.setItem(key, JSON.stringify(Array.from(collapsed)));
    } catch {
      // Ignore storage failures.
    }
  };

  createEffect(() => {
    const key = collapsedStorageKey();
    const restored = loadCollapsedState(key);
    setCollapsedBlocks(new Set<string>(restored));
    setCollapsedKeyLoaded(key);
  });

  createEffect(() => {
    const key = collapsedStorageKey();
    if (collapsedKeyLoaded() !== key) return;
    persistCollapsedState(key, collapsedBlocks());
  });

  const outline = createMemo<OutlineState>(() => {
    const collapsed = collapsedBlocks();
    const items: OutlineItem[] = [];
    const visible: OutlineItem[] = [];
    const visibleToActual: number[] = [];
    const actualToVisible = new Array(blocks.length).fill(-1);
    const stack: number[] = [];
    const collapsedFlags: boolean[] = [];
    const embeddedFlags: boolean[] = [];

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      while (
        stack.length > 0 &&
        blocks[stack[stack.length - 1]].indent >= block.indent
      ) {
        stack.pop();
        collapsedFlags.pop();
        embeddedFlags.pop();
      }
      const parentIndex = stack.length > 0 ? stack[stack.length - 1] : null;
      const ancestorCollapsed =
        collapsedFlags.length > 0 ? collapsedFlags[collapsedFlags.length - 1] : false;
      const ancestorEmbedded =
        embeddedFlags.length > 0 ? embeddedFlags[embeddedFlags.length - 1] : false;
      const next = blocks[index + 1];
      const hasChildren = !!next && next.indent > block.indent;
      const type = getBlockType(block);
      const isCollapsed =
        (hasChildren || type === "toggle") && collapsed.has(block.id);
      const item: OutlineItem = {
        block,
        index,
        indent: block.indent,
        parentIndex,
        hasChildren,
        collapsed: isCollapsed,
        hidden: ancestorCollapsed || ancestorEmbedded
      };
      items.push(item);
      if (!item.hidden) {
        actualToVisible[index] = visible.length;
        visible.push(item);
        visibleToActual.push(index);
      }
      if (hasChildren) {
        stack.push(index);
        collapsedFlags.push(ancestorCollapsed || isCollapsed);
        embeddedFlags.push(ancestorEmbedded || type === "column_layout");
      }
    }

    return { items, visible, visibleToActual, actualToVisible };
  });

  const rowMetrics = createMemo(() => {
    const visible = outline().visible;
    const heights = visible.map((item) =>
      Math.max(ROW_HEIGHT, blockHeights[item.block.id] ?? ROW_HEIGHT)
    );
    let offset = 0;
    const offsets = heights.map((height) => {
      const current = offset;
      offset += height;
      return current;
    });
    return { heights, offsets, totalHeight: offset };
  });

  const findIndexById = (id: string) =>
    blocks.findIndex((block) => block.id === id);

  const getVisibleIndexById = (id: string) => {
    const actualIndex = findIndexById(id);
    if (actualIndex < 0) return -1;
    return outline().actualToVisible[actualIndex] ?? -1;
  };

  const getSelectedActualIndexes = () => {
    const rangeValue = selectionRange();
    if (!rangeValue) return [];
    const indices: number[] = [];
    const map = outline().visibleToActual;
    for (let i = rangeValue.start; i <= rangeValue.end; i += 1) {
      const actual = map[i];
      if (typeof actual === "number") {
        indices.push(actual);
      }
    }
    return indices;
  };

  const formatBreadcrumbLabel = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return "Untitled";
    if (trimmed.length <= 36) return trimmed;
    return `${trimmed.slice(0, 33)}...`;
  };

  const clearSelection = () => {
    setSelectionRange(null);
    setContextMenu(null);
    setDragBox(null);
    selecting = false;
    selectionPointerId = null;
    selectionAnchor = -1;
    dragStartClientY = null;
  };

  const setHandleDraggingState = (value: boolean) => {
    setHandleDragging(value);
    if (typeof document === "undefined") return;
    document.body.classList.toggle("is-block-dragging", value);
  };

  const setSelectionRangeValue = (start: number, end: number, anchor = start) => {
    setSelectionRange({ start, end });
    selectionAnchor = anchor;
  };

  const updateDragBox = (startY: number, currentY: number) => {
    if (!editorRef) return;
    const rect = editorRef.getBoundingClientRect();
    const topRaw = Math.min(startY, currentY) - rect.top;
    const bottomRaw = Math.max(startY, currentY) - rect.top;
    const top = Math.max(0, Math.min(rect.height, topRaw));
    const bottom = Math.max(0, Math.min(rect.height, bottomRaw));
    const height = Math.max(2, bottom - top);
    setDragBox({ top, height });
  };

  const isSelectionStartTarget = (target: EventTarget | null) => {
    const el = target instanceof HTMLElement ? target : null;
    if (!el) return false;
    if (
      el.closest(
        "textarea, input, button, select, a, .block__display, .block__input"
      )
    ) {
      return false;
    }
    return Boolean(el.closest(".block"));
  };

  const indexFromClientY = (clientY: number) => {
    if (!editorRef) return -1;
    const metrics = rowMetrics();
    if (metrics.offsets.length === 0) return -1;
    const rect = editorRef.getBoundingClientRect();
    const relativeY = clientY - rect.top + editorRef.scrollTop;
    const clamped = Math.max(
      0,
      Math.min(metrics.totalHeight - 1, relativeY)
    );
    let low = 0;
    let high = metrics.offsets.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const offset = metrics.offsets[mid] ?? 0;
      if (offset <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, Math.min(metrics.offsets.length - 1, low - 1));
  };

  const resolveIndexFromEvent = (target: EventTarget | null, clientY: number) => {
    const el = target instanceof HTMLElement ? target : null;
    const blockEl = el?.closest<HTMLElement>(".block");
    const blockId = blockEl?.dataset.blockId;
    if (blockId) {
      const index = getVisibleIndexById(blockId);
      if (index >= 0) return index;
    }
    return indexFromClientY(clientY);
  };

  const applyShiftSelection = (targetIndex: number) => {
    if (targetIndex < 0) return;
    let anchorIndex = selectionAnchor;
    if (anchorIndex < 0) {
      const active = activeId();
      if (active) {
        const activeIndex = getVisibleIndexById(active);
        if (activeIndex >= 0) {
          anchorIndex = activeIndex;
        }
      }
    }
    if (anchorIndex < 0) {
      anchorIndex = targetIndex;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    setSelectionRangeValue(start, end, anchorIndex);
  };

  const isIndexSelected = (index: number) => {
    const rangeValue = selectionRange();
    if (!rangeValue) return false;
    return index >= rangeValue.start && index <= rangeValue.end;
  };

  const setSelectionFromIndex = (index: number) => {
    if (selectionAnchor < 0 || index < 0) return;
    const start = Math.min(selectionAnchor, index);
    const end = Math.max(selectionAnchor, index);
    setSelectionRange((prev) =>
      prev && prev.start === start && prev.end === end ? prev : { start, end }
    );
  };

  const beginSelection = (
    index: number,
    pointerId: number | null,
    clientY: number
  ) => {
    selectionAnchor = index;
    selecting = true;
    selectionPointerId = pointerId;
    dragStartClientY = clientY;
    setSelectionRange({ start: index, end: index });
    updateDragBox(clientY, clientY);
  };

  const endSelection = (pointerId?: number | null) => {
    if (!selecting) return;
    if (
      selectionPointerId !== null &&
      typeof pointerId === "number" &&
      pointerId !== selectionPointerId
    ) {
      return;
    }
    selecting = false;
    selectionPointerId = null;
    dragStartClientY = null;
    setDragBox(null);
    const rangeValue = selectionRange();
    selectionAnchor = rangeValue ? rangeValue.start : -1;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!supportsPointer) return;
    if (event.button !== 0) return;
    if (!event.shiftKey && selectionRange()) {
      clearSelection();
    }
    if (!isSelectionStartTarget(event.target)) return;
    const index = resolveIndexFromEvent(event.target, event.clientY);
    if (index < 0) return;
    event.preventDefault();
    beginSelection(index, event.pointerId, event.clientY);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!supportsPointer || !selecting) return;
    if (
      selectionPointerId !== null &&
      event.pointerId !== selectionPointerId
    ) {
      return;
    }
    const index = resolveIndexFromEvent(event.target, event.clientY);
    if (index < 0) return;
    setSelectionFromIndex(index);
    if (dragStartClientY !== null) {
      updateDragBox(dragStartClientY, event.clientY);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!supportsPointer) return;
    endSelection(event.pointerId);
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (selecting || selectionPointerId !== null) return;
    if (event.button !== 0) return;
    if (!event.shiftKey && selectionRange()) {
      clearSelection();
    }
    if (!isSelectionStartTarget(event.target)) return;
    const index = resolveIndexFromEvent(event.target, event.clientY);
    if (index < 0) return;
    event.preventDefault();
    beginSelection(index, null, event.clientY);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!selecting || selectionPointerId !== null) return;
    const index = resolveIndexFromEvent(event.target, event.clientY);
    if (index < 0) return;
    setSelectionFromIndex(index);
    if (dragStartClientY !== null) {
      updateDragBox(dragStartClientY, event.clientY);
    }
  };

  const handleMouseUp = () => {
    if (selectionPointerId !== null) return;
    endSelection();
  };

  const handleBodyClick = (event: MouseEvent) => {
    if (contextMenu()) {
      setContextMenu(null);
    }
    if (outlineMenuOpen()) {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest(".editor-outline-menu") &&
        !target?.closest(".editor-pane__outline")
      ) {
        setOutlineMenuOpen(false);
      }
    }
    if (!selectionRange()) return;
    if (event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".block") || target?.closest(".block-selection-menu")) {
      return;
    }
    clearSelection();
  };

  const handleContextMenu = (event: MouseEvent) => {
    const rangeValue = selectionRange();
    if (!rangeValue) return;
    const index = resolveIndexFromEvent(event.target, event.clientY);
    if (index < 0 || !isIndexSelected(index)) return;
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
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
            const index = getVisibleIndexById(id);
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
    if (previewCloseTimeout) {
      window.clearTimeout(previewCloseTimeout);
    }
    setHandleDraggingState(false);
    blockObserver?.disconnect();
  });

  const range = createMemo(() => {
    const metrics = rowMetrics();
    return getVirtualRange({
      count: outline().visible.length,
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
    outline().visible.slice(range().start, range().end)
  );

  const selectionCount = createMemo(() => {
    const rangeValue = selectionRange();
    return rangeValue ? rangeValue.end - rangeValue.start + 1 : 0;
  });

  const handleDroppedFiles = async (files: FileList | File[]) => {
    if (!isTauri()) return;
    const items = Array.from(files);
    if (items.length === 0) return;
    const markdowns: string[] = [];
    for (const file of items) {
      try {
        if (!file.type.startsWith("image/")) continue;
        const imported = await importImageFile(file);
        if (imported?.markdown) {
          markdowns.push(imported.markdown);
        }
      } catch (error) {
        console.error("Failed to import dropped image", error);
      }
    }
    insertImageBlocksAfterActive(markdowns);
  };

  const handleDrop = (event: DragEvent) => {
    if (!isTauri()) return;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    void handleDroppedFiles(files);
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (!isTauri()) return;
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    const hasImage = Array.from(files).some((file) => file.type.startsWith("image/"));
    if (!hasImage) return;
    event.preventDefault();
    void handleDroppedFiles(files);
  };

  const breadcrumbItems = createMemo(() => {
    const currentId = focusedId() ?? activeId();
    if (!currentId) return [] as OutlineItem[];
    const index = findIndexById(currentId);
    if (index < 0) return [] as OutlineItem[];
    const items = outline().items;
    const chain: OutlineItem[] = [];
    let current: number | null = index;
    while (current !== null) {
      const currentIndex: number = current;
      const item: OutlineItem | undefined = items[currentIndex];
      if (!item) break;
      chain.push(item);
      current = item.parentIndex;
    }
    return chain.reverse();
  });

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
    const handleDragOver = (event: DragEvent) => {
      if (!isTauri()) return;
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    };
    editorRef.addEventListener("scroll", handleScroll);
    editorRef.addEventListener("dragover", handleDragOver);
    editorRef.addEventListener("drop", handleDrop);
    editorRef.addEventListener("paste", handlePaste);

    const resizeObserver = new ResizeObserver(() => {
      if (!editorRef) return;
      setViewportHeight(editorRef.clientHeight);
    });
    resizeObserver.observe(editorRef);

    onCleanup(() => {
      editorRef?.removeEventListener("scroll", handleScroll);
      editorRef?.removeEventListener("dragover", handleDragOver);
      editorRef?.removeEventListener("drop", handleDrop);
      editorRef?.removeEventListener("paste", handlePaste);
      resizeObserver.disconnect();
    });
  });

  onMount(() => {
    const handlePointerMoveWindow = (event: PointerEvent) => {
      handlePointerMove(event);
      handleHandlePointerMove(event);
    };
    const handlePointerUpWindow = (event: PointerEvent) => {
      handlePointerUp(event);
      handleHandlePointerUp(event);
    };
    const handleMouseMoveWindow = (event: MouseEvent) => handleMouseMove(event);
    const handleMouseUpWindow = () => handleMouseUp();

    if (supportsPointer) {
      window.addEventListener("pointermove", handlePointerMoveWindow);
      window.addEventListener("pointerup", handlePointerUpWindow);
      window.addEventListener("pointercancel", handlePointerUpWindow);
    }
    window.addEventListener("mousemove", handleMouseMoveWindow);
    window.addEventListener("mouseup", handleMouseUpWindow);

    onCleanup(() => {
      if (supportsPointer) {
        window.removeEventListener("pointermove", handlePointerMoveWindow);
        window.removeEventListener("pointerup", handlePointerUpWindow);
        window.removeEventListener("pointercancel", handlePointerUpWindow);
      }
      window.removeEventListener("mousemove", handleMouseMoveWindow);
      window.removeEventListener("mouseup", handleMouseUpWindow);
    });
  });

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const rangeValue = selectionRange();
      if (!rangeValue) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest("textarea, input, select")) return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        adjustSelectionIndent(event.shiftKey ? -1 : 1);
        return;
      }

      if (isMoveShortcut(event)) {
        event.preventDefault();
        moveSelectionBy(event.key === "ArrowUp" ? -1 : 1);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeSelection();
        return;
      }

      if (
        (event.key === "d" || event.key === "D") &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        duplicateSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  const scrollToVisibleIndex = (index: number) => {
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
    if (index >= 0) {
      expandAncestors(index);
      const visibleIndex = getVisibleIndexById(id);
      if (visibleIndex >= 0) {
        scrollToVisibleIndex(visibleIndex);
      }
    }
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

  createEffect(() => {
    activePageUid();
    clearSelection();
    setOutlineMenuOpen(false);
  });

  const insertBlockAfter = (index: number, indent: number) => {
    const block = createNewBlock("", indent);
    setBlocks(
      produce((draft) => {
        draft.splice(index + 1, 0, block);
      })
    );
    scheduleSave();
    setActiveId(block.id);
    setFocusedId(block.id);
    setJumpTarget({ id: block.id, caret: "start" });
  };

  const toggleTodoAt = (index: number) => {
    const block = blocks[index];
    if (!block) return;
    const checked = isTodoChecked(block.text);
    const next = toggleTodoText(block.text, !checked);
    setBlocks(index, (prev) => ({
      ...prev,
      text: next,
      block_type: "todo"
    }));
    scheduleSave();
  };

  const addColumnToLayout = (layoutIndex: number) => {
    const layoutBlock = blocks[layoutIndex];
    if (!layoutBlock) return;
    const layoutIndent = layoutBlock.indent;
    let insertIndex = layoutIndex + 1;
    while (insertIndex < blocks.length && blocks[insertIndex].indent > layoutIndent) {
      insertIndex += 1;
    }
    const column = createNewBlock("", layoutIndent + 1, "column");
    const child = createNewBlock("", layoutIndent + 2, "text");
    setBlocks(
      produce((draft) => {
        draft.splice(insertIndex, 0, column, child);
      })
    );
    scheduleSave();
  };

  const insertImageBlocksAfterActive = (markdowns: string[]) => {
    const nonEmpty = markdowns.map((value) => value.trim()).filter(Boolean);
    if (nonEmpty.length === 0) return;
    const activeIndex = activeId() ? findIndexById(activeId() as string) : -1;
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : blocks.length;
    const created = nonEmpty.map((markdown) =>
      createNewBlock(markdown, activeIndex >= 0 ? blocks[activeIndex].indent : 0, "image")
    );
    setBlocks(
      produce((draft) => {
        draft.splice(insertAt, 0, ...created);
      })
    );
    scheduleSave();
    const first = created[0];
    if (first) {
      focusBlock(first.id, "end");
    }
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

  const duplicateSelection = () => {
    const rangeValue = selectionRange();
    if (!rangeValue) return;
    const selected = getSelectedActualIndexes();
    if (selected.length === 0) return;
    const clones = selected.map((index) =>
      createNewBlock(
        blocks[index].text,
        blocks[index].indent,
        getBlockType(blocks[index])
      )
    );
    const insertIndex = selected[selected.length - 1] + 1;
    setBlocks(
      produce((draft) => {
        draft.splice(insertIndex, 0, ...clones);
      })
    );
    scheduleSave();
    const startVisible = rangeValue.end + 1;
    const endVisible = startVisible + clones.length - 1;
    setSelectionRangeValue(startVisible, endVisible, startVisible);
  };

  const removeSelection = () => {
    const selected = getSelectedActualIndexes();
    if (selected.length === 0) return;
    const count = selected.length;
    if (count >= blocks.length) {
      const replacement = createNewBlock("", 0);
      setBlocks([replacement]);
      scheduleSave();
      clearSelection();
      focusBlock(replacement.id, "start");
      return;
    }
    const removedIds = new Set(selected.map((index) => blocks[index].id));
    const firstIndex = selected[0];
    const lastIndex = selected[selected.length - 1];
    let nextIndex = lastIndex + 1;
    while (nextIndex < blocks.length && removedIds.has(blocks[nextIndex].id)) {
      nextIndex += 1;
    }
    let prevIndex = firstIndex - 1;
    while (prevIndex >= 0 && removedIds.has(blocks[prevIndex].id)) {
      prevIndex -= 1;
    }
    const nextTarget = blocks[nextIndex] ?? blocks[prevIndex];

    setBlocks(
      produce((draft) => {
        for (let i = draft.length - 1; i >= 0; i -= 1) {
          if (removedIds.has(draft[i].id)) {
            draft.splice(i, 1);
          }
        }
      })
    );
    scheduleSave();
    clearSelection();
    if (nextTarget) {
      focusBlock(nextTarget.id, "start");
    }
  };

  const adjustSelectionIndent = (delta: number) => {
    const selected = getSelectedActualIndexes();
    if (selected.length === 0) return;
    setBlocks(
      produce((draft) => {
        for (const index of selected) {
          if (!draft[index]) continue;
          const nextIndent = Math.max(0, draft[index].indent + delta);
          draft[index].indent = nextIndent;
        }
      })
    );
    scheduleSave();
  };

  const getSubtreeEnd = (startIndex: number) => {
    if (!blocks[startIndex]) return startIndex;
    const baseIndent = blocks[startIndex].indent;
    let end = startIndex;
    for (let index = startIndex + 1; index < blocks.length; index += 1) {
      if (blocks[index].indent <= baseIndent) break;
      end = index;
    }
    return end;
  };

  const getSubtreeEndFor = (source: Block[], startIndex: number) => {
    if (!source[startIndex]) return startIndex;
    const baseIndent = source[startIndex].indent;
    let end = startIndex;
    for (let index = startIndex + 1; index < source.length; index += 1) {
      if (source[index].indent <= baseIndent) break;
      end = index;
    }
    return end;
  };

  const moveBlockRange = (start: number, end: number, insertAt: number) => {
    if (start < 0 || end < start) return;
    const length = end - start + 1;
    setBlocks(
      produce((draft) => {
        const segment = draft.splice(start, length);
        const target = Math.max(0, Math.min(insertAt, draft.length));
        draft.splice(target, 0, ...segment);
      })
    );
    scheduleSave();
  };

  const restoreSelectionByIds = (ids: string[]) => {
    if (ids.length === 0) return;
    const indices = ids
      .map((id) => getVisibleIndexById(id))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
    if (indices.length === 0) return;
    setSelectionRangeValue(indices[0], indices[indices.length - 1], indices[0]);
  };

  const moveSelectionBy = (direction: -1 | 1) => {
    const rangeValue = selectionRange();
    if (!rangeValue) return false;
    const selected = getSelectedActualIndexes();
    if (selected.length === 0) return false;
    const selectedIds = selected
      .map((index) => blocks[index]?.id)
      .filter((id): id is string => Boolean(id));
    const sorted = [...selected].sort((a, b) => a - b);
    const start = sorted[0];
    let end = sorted[sorted.length - 1];
    for (const index of sorted) {
      const subtreeEnd = getSubtreeEnd(index);
      if (subtreeEnd > end) end = subtreeEnd;
    }
    if (direction === -1) {
      const prevVisible = rangeValue.start - 1;
      if (prevVisible < 0) return false;
      const prevActual = outline().visibleToActual[prevVisible];
      if (typeof prevActual !== "number") return false;
      if (prevActual >= start && prevActual <= end) return false;
      moveBlockRange(start, end, prevActual);
      restoreSelectionByIds(selectedIds);
      return true;
    }
    const nextVisible = rangeValue.end + 1;
    if (nextVisible >= outline().visible.length) return false;
    const nextActual = outline().visibleToActual[nextVisible];
    if (typeof nextActual !== "number") return false;
    const nextEnd = getSubtreeEnd(nextActual);
    const length = end - start + 1;
    const insertAt = nextEnd - length + 1;
    moveBlockRange(start, end, insertAt);
    restoreSelectionByIds(selectedIds);
    return true;
  };

  const moveBlockBy = (blockId: string, direction: -1 | 1) => {
    const actualIndex = findIndexById(blockId);
    if (actualIndex < 0) return false;
    const visibleIndex = getVisibleIndexById(blockId);
    if (visibleIndex < 0) return false;
    const start = actualIndex;
    const end = getSubtreeEnd(actualIndex);
    if (direction === -1) {
      const prevVisible = visibleIndex - 1;
      if (prevVisible < 0) return false;
      const prevActual = outline().visibleToActual[prevVisible];
      if (typeof prevActual !== "number") return false;
      if (prevActual >= start && prevActual <= end) return false;
      moveBlockRange(start, end, prevActual);
      focusBlock(blockId, "preserve");
      return true;
    }
    const nextVisible = visibleIndex + 1;
    if (nextVisible >= outline().visible.length) return false;
    const nextActual = outline().visibleToActual[nextVisible];
    if (typeof nextActual !== "number") return false;
    const nextEnd = getSubtreeEnd(nextActual);
    const length = end - start + 1;
    const insertAt = nextEnd - length + 1;
    moveBlockRange(start, end, insertAt);
    focusBlock(blockId, "preserve");
    return true;
  };

  const clearBlockDragState = () => {
    setDraggedBlockId(null);
    setBlockDropHint(null);
    setColumnDropTargetId(null);
    setHandleDraggingState(false);
    handleDragPointerId = null;
  };

  const dropPositionForEvent = (
    event: DragEvent,
    target: HTMLElement
  ): "before" | "after" => {
    const rect = target.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    return event.clientY > middle ? "after" : "before";
  };

  const moveDraggedBlockTo = (
    targetBlockId: string,
    position: "before" | "after",
    desiredRootIndent?: number
  ) => {
    const sourceBlockId = draggedBlockId();
    if (!sourceBlockId) return false;
    const sourceStart = findIndexById(sourceBlockId);
    const targetIndex = findIndexById(targetBlockId);
    if (sourceStart < 0 || targetIndex < 0) return false;
    const sourceEnd = getSubtreeEnd(sourceStart);
    if (targetIndex >= sourceStart && targetIndex <= sourceEnd) return false;

    const length = sourceEnd - sourceStart + 1;
    const targetEnd = getSubtreeEnd(targetIndex);
    const insertAtRaw = position === "before" ? targetIndex : targetEnd + 1;
    const insertAt =
      insertAtRaw > sourceEnd ? insertAtRaw - length : insertAtRaw;
    const rootIndent = blocks[sourceStart]?.indent ?? 0;
    const indentDelta =
      typeof desiredRootIndent === "number" ? desiredRootIndent - rootIndent : 0;
    if (insertAt === sourceStart && indentDelta === 0) {
      clearBlockDragState();
      return false;
    }

    setBlocks(
      produce((draft) => {
        const currentSourceStart = draft.findIndex(
          (block) => block.id === sourceBlockId
        );
        const currentTargetIndex = draft.findIndex(
          (block) => block.id === targetBlockId
        );
        if (currentSourceStart < 0 || currentTargetIndex < 0) return;
        const currentSourceEnd = getSubtreeEndFor(draft, currentSourceStart);
        if (
          currentTargetIndex >= currentSourceStart &&
          currentTargetIndex <= currentSourceEnd
        ) {
          return;
        }
        const currentTargetEnd = getSubtreeEndFor(draft, currentTargetIndex);
        const segmentLength = currentSourceEnd - currentSourceStart + 1;
        const segment = draft.splice(currentSourceStart, segmentLength);
        if (indentDelta !== 0) {
          for (const block of segment) {
            block.indent = Math.max(0, block.indent + indentDelta);
          }
        }
        let currentInsertAt =
          position === "before" ? currentTargetIndex : currentTargetEnd + 1;
        if (currentInsertAt > currentSourceStart) {
          currentInsertAt -= segmentLength;
        }
        currentInsertAt = Math.max(0, Math.min(currentInsertAt, draft.length));
        draft.splice(currentInsertAt, 0, ...segment);
      })
    );
    scheduleSave();
    clearBlockDragState();
    if (getVisibleIndexById(sourceBlockId) >= 0) {
      focusBlock(sourceBlockId, "preserve");
    } else {
      setActiveId(sourceBlockId);
      setFocusedId(null);
    }
    return true;
  };

  const handleBlockHandleDragStart = (event: DragEvent, blockId: string) => {
    const index = findIndexById(blockId);
    if (index < 0) return;
    setDraggedBlockId(blockId);
    setBlockDropHint(null);
    setColumnDropTargetId(null);
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", blockId);
    }
  };

  const handleBlockDragOver = (event: DragEvent, blockId: string) => {
    if (!draggedBlockId()) return;
    if (draggedBlockId() === blockId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    setColumnDropTargetId(null);
    setBlockDropHint({
      blockId,
      position: dropPositionForEvent(event, target),
      desiredRootIndent: undefined
    });
  };

  const handleBlockDrop = (event: DragEvent, blockId: string) => {
    if (!draggedBlockId()) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const hinted = blockDropHint();
    const position =
      hinted && hinted.blockId === blockId
        ? hinted.position
        : dropPositionForEvent(event, target);
    const desiredIndent =
      hinted && hinted.blockId === blockId
        ? hinted.desiredRootIndent
        : undefined;
    void moveDraggedBlockTo(blockId, position, desiredIndent);
  };

  const handleColumnDragOver = (event: DragEvent, columnBlockId: string) => {
    if (!draggedBlockId()) return;
    event.preventDefault();
    event.stopPropagation();
    setBlockDropHint(null);
    setColumnDropTargetId(columnBlockId);
  };

  const handleColumnDrop = (event: DragEvent, columnBlockId: string) => {
    if (!draggedBlockId()) return;
    event.preventDefault();
    event.stopPropagation();
    const columnIndex = findIndexById(columnBlockId);
    if (columnIndex < 0) {
      clearBlockDragState();
      return;
    }
    if (resolveBlockType(blocks[columnIndex]) !== "column") {
      clearBlockDragState();
      return;
    }
    const desiredIndent = (blocks[columnIndex]?.indent ?? 0) + 1;
    void moveDraggedBlockTo(columnBlockId, "after", desiredIndent);
  };

  const handleColumnRowDragOver = (event: DragEvent, rowBlockId: string) => {
    if (!draggedBlockId()) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rowIndex = findIndexById(rowBlockId);
    const desiredRootIndent = rowIndex >= 0 ? blocks[rowIndex].indent : undefined;
    setColumnDropTargetId(null);
    setBlockDropHint({
      blockId: rowBlockId,
      position: dropPositionForEvent(event, target),
      desiredRootIndent
    });
  };

  const handleColumnRowDrop = (event: DragEvent, rowBlockId: string) => {
    if (!draggedBlockId()) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rowIndex = findIndexById(rowBlockId);
    if (rowIndex < 0) {
      clearBlockDragState();
      return;
    }
    const hinted = blockDropHint();
    const position =
      hinted && hinted.blockId === rowBlockId
        ? hinted.position
        : dropPositionForEvent(event, target);
    const desiredIndent =
      hinted && hinted.blockId === rowBlockId
        ? hinted.desiredRootIndent ?? blocks[rowIndex]?.indent ?? 0
        : blocks[rowIndex]?.indent ?? 0;
    void moveDraggedBlockTo(rowBlockId, position, desiredIndent);
  };

  const dropPositionForPoint = (
    clientY: number,
    target: HTMLElement
  ): "before" | "after" => {
    const rect = target.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    return clientY > middle ? "after" : "before";
  };

  const updatePointerDropHint = (clientX: number, clientY: number) => {
    if (!draggedBlockId()) return;
    const element = document.elementFromPoint(clientX, clientY);
    const target = element instanceof HTMLElement ? element : null;
    if (!target) {
      setBlockDropHint(null);
      setColumnDropTargetId(null);
      return;
    }

    const rowTarget = target.closest<HTMLElement>(".column-layout-preview__row");
    if (rowTarget) {
      const rowBlockId = rowTarget.dataset.rowBlockId;
      if (rowBlockId) {
        const rowIndex = findIndexById(rowBlockId);
        if (rowIndex >= 0) {
          setColumnDropTargetId(null);
          setBlockDropHint({
            blockId: rowBlockId,
            position: dropPositionForPoint(clientY, rowTarget),
            desiredRootIndent: blocks[rowIndex].indent
          });
          return;
        }
      }
    }

    const columnTarget = target.closest<HTMLElement>(".column-layout-preview__column");
    if (columnTarget) {
      const columnBlockId = columnTarget.dataset.columnBlockId;
      if (columnBlockId) {
        setBlockDropHint(null);
        setColumnDropTargetId(columnBlockId);
        return;
      }
    }

    const blockTarget = target.closest<HTMLElement>(".block");
    const blockId = blockTarget?.dataset.blockId;
    if (
      blockTarget &&
      blockId &&
      blockId !== draggedBlockId()
    ) {
      setColumnDropTargetId(null);
      setBlockDropHint({
        blockId,
        position: dropPositionForPoint(clientY, blockTarget),
        desiredRootIndent: undefined
      });
      return;
    }

    setBlockDropHint(null);
    setColumnDropTargetId(null);
  };

  const startHandlePointerDrag = (event: PointerEvent, blockId: string) => {
    if (event.button !== 0) return;
    if (findIndexById(blockId) < 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggedBlockId(blockId);
    setBlockDropHint(null);
    setColumnDropTargetId(null);
    handleDragPointerId = event.pointerId;
    setHandleDraggingState(true);
  };

  const handleHandlePointerMove = (event: PointerEvent) => {
    if (!handleDragging()) return;
    if (
      handleDragPointerId !== null &&
      event.pointerId !== handleDragPointerId
    ) {
      return;
    }
    event.preventDefault();
    updatePointerDropHint(event.clientX, event.clientY);
  };

  const commitHandlePointerDrop = () => {
    const sourceBlockId = draggedBlockId();
    if (!sourceBlockId) {
      clearBlockDragState();
      return;
    }
    const columnId = columnDropTargetId();
    if (columnId) {
      const columnIndex = findIndexById(columnId);
      if (columnIndex >= 0 && resolveBlockType(blocks[columnIndex]) === "column") {
        void moveDraggedBlockTo(
          columnId,
          "after",
          (blocks[columnIndex]?.indent ?? 0) + 1
        );
        return;
      }
    }
    const hint = blockDropHint();
    if (hint) {
      void moveDraggedBlockTo(hint.blockId, hint.position, hint.desiredRootIndent);
      return;
    }
    clearBlockDragState();
  };

  const handleHandlePointerUp = (event: PointerEvent) => {
    if (!handleDragging()) return;
    if (
      handleDragPointerId !== null &&
      event.pointerId !== handleDragPointerId
    ) {
      return;
    }
    event.preventDefault();
    commitHandlePointerDrop();
  };

  const moveFocus = (index: number, direction: -1 | 1) => {
    const visibleIndex = outline().actualToVisible[index] ?? -1;
    if (visibleIndex < 0) return;
    const nextVisible = visibleIndex + direction;
    const nextActual = outline().visibleToActual[nextVisible];
    if (typeof nextActual !== "number") return;
    const target = blocks[nextActual];
    if (!target) return;
    focusBlock(target.id, direction === -1 ? "end" : "start");
  };

  const isDescendantIndex = (parentIndex: number, targetIndex: number) => {
    if (targetIndex <= parentIndex) return false;
    const baseIndent = blocks[parentIndex]?.indent ?? 0;
    for (let index = parentIndex + 1; index < blocks.length; index += 1) {
      const indent = blocks[index].indent;
      if (indent <= baseIndent) return false;
      if (index === targetIndex) return true;
    }
    return false;
  };

  const expandAncestors = (index: number) => {
    const items = outline().items;
    let current = items[index]?.parentIndex ?? null;
    if (current === null) return;
    const next = new Set<string>(collapsedBlocks());
    let changed = false;
    while (current !== null) {
      const currentIndex: number = current;
      const item: OutlineItem | undefined = items[currentIndex];
      if (item && next.has(item.block.id)) {
        next.delete(item.block.id);
        changed = true;
      }
      current = item?.parentIndex ?? null;
    }
    if (changed) {
      setCollapsedBlocks(next);
    }
  };

  const toggleCollapse = (item: OutlineItem) => {
    const type = getBlockType(item.block);
    const canToggle = item.hasChildren || type === "toggle";
    if (!canToggle) return;
    const next = new Set<string>(collapsedBlocks());
    const isCollapsing = !next.has(item.block.id);
    if (isCollapsing) {
      next.add(item.block.id);
    } else {
      next.delete(item.block.id);
    }
    setCollapsedBlocks(next);
    clearSelection();

    if (isCollapsing) {
      const focused = focusedId();
      if (!focused) return;
      const focusedIndex = findIndexById(focused);
      if (focusedIndex >= 0 && isDescendantIndex(item.index, focusedIndex)) {
        focusBlock(item.block.id, "end");
      }
    }
  };

  const foldToLevel = (level: number) => {
    const next = new Set<string>();
    for (const item of outline().items) {
      if (item.hasChildren && item.indent >= level) {
        next.add(item.block.id);
      }
    }
    setCollapsedBlocks(next);
    clearSelection();
  };

  const unfoldAll = () => {
    if (collapsedBlocks().size === 0) return;
    setCollapsedBlocks(new Set<string>());
    clearSelection();
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
    let position: CaretPosition;
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

  const applyInlineTextCommand = (
    commandId: string,
    before: string,
    after: string
  ) => {
    const cleaned = `${before}${after}`;
    if (commandId === "link") {
      const insertText = "[[Page]]";
      return { nextText: `${before}${insertText}${after}`, nextCaret: before.length + insertText.length };
    }
    if (commandId === "date") {
      const insertText = new Date().toISOString().slice(0, 10);
      return { nextText: `${before}${insertText}${after}`, nextCaret: before.length + insertText.length };
    }
    if (commandId === "bold") {
      const trimmed = cleaned.trim();
      const nextText = `**${trimmed}**`;
      return { nextText, nextCaret: nextText.length };
    }
    if (commandId === "italic") {
      const trimmed = cleaned.trim();
      const nextText = `_${trimmed}_`;
      return { nextText, nextCaret: nextText.length };
    }
    const trimmed = cleaned.trim();
    return { nextText: trimmed, nextCaret: trimmed.length };
  };

  const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
  };

  const importImageFile = async (file: File) => {
    if (!isTauri()) return null;
    const filename = file.name || "image";
    const mimeType = file.type || "application/octet-stream";
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const result = (await invoke<{
      asset_path: string;
      markdown: string;
      mime_type: string;
      original_name: string;
    }>("import_image_asset_bytes", {
      filename,
      mimeType,
      mime_type: mimeType,
      bytesB64: bytesToBase64(bytes),
      bytes_b64: bytesToBase64(bytes)
    })) as {
      asset_path: string;
      markdown: string;
      mime_type: string;
      original_name: string;
    };
    return result;
  };

  const importImageFromPicker = async () => {
    if (!isTauri()) return null;
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: [...IMAGE_EXTENSIONS]
        }
      ]
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path || typeof path !== "string") return null;
    const result = await invoke<{
      asset_path: string;
      markdown: string;
      mime_type: string;
      original_name: string;
    }>("import_image_asset", {
      path
    });
    return result;
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
    let nextType: BlockType | null = null;

    if (commandId === "todo" || commandId === "task") {
      nextType = "todo";
      const content = cleanTextForBlockType(`${before}${after}`, "todo");
      nextText = toggleTodoText(content, false);
      nextCaret = nextText.length;
    } else if (commandId === "h1") {
      nextType = "text";
      const content = cleanTextForBlockType(`${before}${after}`, "heading1");
      nextText = `# ${content}`;
      nextCaret = nextText.length;
    } else if (commandId === "h2") {
      nextType = "text";
      const content = cleanTextForBlockType(`${before}${after}`, "heading1");
      nextText = `## ${content}`;
      nextCaret = nextText.length;
    } else if (commandId === "h3") {
      nextType = "text";
      const content = cleanTextForBlockType(`${before}${after}`, "heading1");
      nextText = `### ${content}`;
      nextCaret = nextText.length;
    } else if (commandId === "quote") {
      nextType = "quote";
      nextText = cleanTextForBlockType(`${before}${after}`, nextType);
      nextCaret = nextText.length;
    } else if (commandId === "callout") {
      nextType = "callout";
      nextText = `${before}${after}`.trim();
      nextCaret = nextText.length;
    } else if (commandId === "toggle") {
      nextType = "toggle";
      nextText = `${before}${after}`.trim();
      nextCaret = nextText.length;
    } else if (commandId === "code") {
      nextType = "code";
      nextText = `${before}${after}`.trim();
      nextCaret = nextText.length;
    } else if (commandId === "divider") {
      nextType = "divider";
      nextText = "";
      nextCaret = 0;
    } else if (commandId === "database") {
      nextType = "database_view";
      nextText = `${before}${after}`.trim();
      nextCaret = nextText.length;
    } else if (commandId === "image") {
      closeSlashMenu();
      void (async () => {
        const imported = await importImageFromPicker();
        if (!imported) return;
        setBlocks(index, (prev) => ({
          ...prev,
          text: imported.markdown,
          block_type: "image"
        }));
        scheduleSave();
        requestAnimationFrame(() => {
          const input = inputRefs.get(block.id);
          if (!input) return;
          const caret = imported.markdown.length;
          input.focus();
          input.setSelectionRange(caret, caret);
          storeSelection(block.id, input, true);
        });
      })();
      return;
    } else {
      const transformed = applyInlineTextCommand(commandId, before, after);
      nextText = transformed.nextText;
      nextCaret = transformed.nextCaret;
    }

    setBlocks(index, "text", nextText);
    if (nextType) {
      setBlocks(index, "block_type", nextType);
    }
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
    let position: CaretPosition;
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

  const wikilinkQuery = createMemo(() => wikilinkMenu().query.trim());
  const wikilinkMatches = createMemo(() => {
    const query = wikilinkQuery().toLowerCase();
    if (!query) return pages();
    return pages().filter((page) =>
      (page.title || page.uid || "").toLowerCase().includes(query)
    );
  });
  const wikilinkCreateLabel = createMemo(() => {
    const query = wikilinkQuery();
    if (!query) return null;
    const normalized = normalizePageUid(query);
    const existing = pages().some(
      (page) => normalizePageUid(page.uid || page.title) === normalized
    );
    if (existing) return null;
    return `Create page "${query}"`;
  });

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

  const openRenameDialog = () => {
    const currentTitle = renameTitle().trim() || pageTitle();
    setDialogMode("rename");
    setDialogTarget(null);
    setDialogValue(currentTitle);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDialogMode(null);
    setDialogTarget(null);
  };

  const dialogTitle = createMemo(() =>
    dialogMode() === "rename" ? "Rename page" : "Link to page"
  );

  const dialogConfirmLabel = createMemo(() =>
    dialogMode() === "rename" ? "Rename" : "Link"
  );

  const dialogDisabled = createMemo(() => {
    const value = dialogValue().trim();
    if (!value) return true;
    if (dialogMode() === "rename") {
      const currentTitle = renameTitle().trim() || pageTitle();
      return value === currentTitle;
    }
    return false;
  });

  const confirmDialog = async () => {
    const mode = dialogMode();
    const value = dialogValue().trim();
    if (!mode) {
      closeDialog();
      return;
    }
    if (mode === "rename") {
      const currentTitle = renameTitle().trim() || pageTitle();
      if (!value || value === currentTitle) {
        closeDialog();
        return;
      }
      setRenameTitle(value);
      void renamePage();
      closeDialog();
      return;
    }
    const target = dialogTarget();
    if (!value || !target) {
      closeDialog();
      return;
    }
    const block = blocks[target.index];
    if (!block || block.id !== target.id) {
      closeDialog();
      return;
    }
    const link = `[[${value}]]`;
    const separator = block.text.trim().length ? " " : "";
    const nextText = `${block.text}${separator}${link}`;
    setBlocks(target.index, "text", nextText);
    if (!isTauri()) {
      const snapshot = snapshotBlocks(blocks);
      if (snapshot[target.index]) {
        snapshot[target.index].text = nextText;
      }
      saveLocalPageSnapshot(activePageUid(), pageTitle(), snapshot);
    }
    scheduleSave();

    await openPageByTitle(value);
    closeDialog();
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

  const loadPreviewBlocks = async (pageUid: PageId) => {
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

  const openLinkPreview = async (targetTitle: string, anchor: HTMLElement) => {
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
    const previewBlocks = await loadPreviewBlocks(pageUid);
    const title = resolved?.title ?? targetTitle;
    previewCache.set(pageUid, { title, blocks: previewBlocks });
    setLinkPreview((prev) => ({
      ...prev,
      blocks: previewBlocks,
      loading: false
    }));
  };

  const handleKeyDown = (block: Block, index: number, event: KeyboardEvent) => {
    const target = event.currentTarget as HTMLTextAreaElement;
    const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
    const atEnd =
      target.selectionStart === target.value.length &&
      target.selectionEnd === target.value.length;

    if (isMoveShortcut(event)) {
      if (!selectionRange()) {
        event.preventDefault();
        moveBlockBy(block.id, event.key === "ArrowUp" ? -1 : 1);
      }
      return;
    }

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
      if (event.shiftKey) return;
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

  const getPluginBlockRenderer = (text: string) => {
    const fence = parseInlineFence(text);
    if (!fence) return null;
    return blockRenderersByLang().get(fence.lang) ?? null;
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
                fallback={<div class="diagram-loading">Rendering diagram...</div>}
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

  const renderImageDisplay = (text: string): JSX.Element => {
    const source = extractImageSource(text);
    if (!source) {
      return (
        <div class="block-renderer block-renderer--image">
          <div class="block-renderer__title">Image</div>
          <div class="block-renderer__empty">Enter an HTTP(S) URL or /assets path.</div>
        </div>
      );
    }
    if (source.startsWith("http://") || source.startsWith("https://")) {
      return (
        <div class="block-renderer block-renderer--image">
          <div class="block-renderer__title">Image</div>
          <img class="block-renderer__image" src={source} alt="" loading="lazy" />
        </div>
      );
    }
    return (
      <div class="block-renderer block-renderer--image">
        <div class="block-renderer__title">Image asset</div>
        <div class="block-renderer__asset-path">{source}</div>
      </div>
    );
  };

  type ColumnPreviewRow = {
    blockId: string;
    actualIndex: number;
    depth: number;
  };

  type ColumnPreviewData = {
    columnBlockId: string;
    columnIndent: number;
    rows: ColumnPreviewRow[];
  };

  const buildColumnLayoutPreview = (layoutIndex: number): ColumnPreviewData[] => {
    const layout = blocks[layoutIndex];
    if (!layout || resolveBlockType(layout) !== "column_layout") return [];
    const layoutIndent = layout.indent;
    const collapsed = collapsedBlocks();
    const columns: ColumnPreviewData[] = [];
    let cursor = layoutIndex + 1;
    while (cursor < blocks.length && blocks[cursor].indent > layoutIndent) {
      const block = blocks[cursor];
      if (
        block.indent === layoutIndent + 1 &&
        resolveBlockType(block) === "column"
      ) {
        const columnIndent = block.indent;
        const column: ColumnPreviewData = {
          columnBlockId: block.id,
          columnIndent,
          rows: []
        };
        const collapsedIndentStack: number[] = [];
        cursor += 1;
        while (cursor < blocks.length && blocks[cursor].indent > columnIndent) {
          const child = blocks[cursor];
          while (
            collapsedIndentStack.length > 0 &&
            child.indent <= collapsedIndentStack[collapsedIndentStack.length - 1]
          ) {
            collapsedIndentStack.pop();
          }
          const hiddenByCollapsed = collapsedIndentStack.length > 0;
          const childType = resolveBlockType(child);
          const next = blocks[cursor + 1];
          const hasChildren = !!next && next.indent > child.indent;
          if (childType !== "column" && !hiddenByCollapsed) {
            column.rows.push({
              blockId: child.id,
              actualIndex: cursor,
              depth: Math.max(0, child.indent - columnIndent - 1)
            });
          }
          if (hasChildren && collapsed.has(child.id)) {
            collapsedIndentStack.push(child.indent);
          }
          cursor += 1;
        }
        columns.push(column);
        continue;
      }
      cursor += 1;
    }
    return columns;
  };

  const ColumnLayoutPreview = (props: { layoutIndex: number }) => {
    const columns = () => buildColumnLayoutPreview(props.layoutIndex);
    return (
      <div class="block-renderer block-renderer--columns">
        <div class="block-renderer__header">
          <button
            class="block-renderer__copy"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              addColumnToLayout(props.layoutIndex);
            }}
          >
            Add column
          </button>
        </div>
        <div class="column-layout-preview">
          <For each={columns()}>
            {(column) => (
              <div
                class={`column-layout-preview__column ${
                  columnDropTargetId() === column.columnBlockId ? "is-drop-target" : ""
                }`}
                data-column-block-id={column.columnBlockId}
                onDragOver={(event) =>
                  handleColumnDragOver(event, column.columnBlockId)
                }
                onDrop={(event) => handleColumnDrop(event, column.columnBlockId)}
              >
                <Show
                  when={column.rows.length > 0}
                  fallback={
                    <div class="column-layout-preview__empty">Empty column</div>
                  }
                >
                  <For each={column.rows}>
                    {(row) => {
                      const child = blocks[row.actualIndex];
                      if (!child) return null;
                      const item = outline().items[row.actualIndex];
                      return renderBlockRow({
                        block: child,
                        actualIndex: row.actualIndex,
                        visibleIndex: getVisibleIndexById(row.blockId),
                        hasChildren: item?.hasChildren ?? false,
                        collapsed: item?.collapsed ?? false,
                        visualIndent: row.depth,
                        isColumnRow: true
                      });
                    }}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    );
  };

  const DatabaseViewPreview = () => (
    <div class="block-renderer block-renderer--database">
      <div class="block-renderer__title">Database view</div>
      <table class="database-preview__table">
        <thead>
          <tr>
            <th>Page</th>
          </tr>
        </thead>
        <tbody>
          <For each={pages().slice(0, 12)}>
            {(page) => (
              <tr>
                <td>
                  <button
                    class="database-preview__page"
                    type="button"
                    onClick={() => void switchPage(page.uid)}
                  >
                    {page.title || page.uid}
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );

  type BlockRowRenderArgs = {
    block: Block;
    actualIndex: number;
    visibleIndex: number;
    hasChildren: boolean;
    collapsed: boolean;
    visualIndent: number;
    isColumnRow?: boolean;
  };

  const renderBlockRow = (args: BlockRowRenderArgs) => {
    const block = args.block;
    const actualIndex = args.actualIndex;
    const visibleIndex = () => args.visibleIndex;
    const blockType = () => getBlockType(block);
    const codePreview = () => getCodePreview(block.text);
    const diagramPreview = () => getDiagramPreview(block.text);
    const pluginRenderer = () => {
      if (
        blockType() !== "text" &&
        blockType() !== "code"
      ) {
        return null;
      }
      return getPluginBlockRenderer(block.text);
    };
    const isEditing = () => focusedId() === block.id;
    const isSelected = () => {
      const idx = visibleIndex();
      if (idx < 0) return false;
      const rangeValue = selectionRange();
      if (!rangeValue) return false;
      return idx >= rangeValue.start && idx <= rangeValue.end;
    };
    const isDragSource = () => draggedBlockId() === block.id;
    const blockDropPosition = () =>
      blockDropHint()?.blockId === block.id
        ? blockDropHint()?.position
        : null;
    const updateBlockText = (blockId: string, nextText: string) => {
      const index = findIndexById(blockId);
      if (index < 0) return;
      if (blocks[index]?.text === nextText) return;
      setBlocks(index, (prev) => ({
        ...prev,
        text: nextText,
        block_type: resolveBlockType(prev)
      }));
      scheduleSave();
    };
    const displayContent = () => {
      if (blockType() === "column_layout") {
        return <ColumnLayoutPreview layoutIndex={actualIndex} />;
      }
      if (blockType() === "database_view") {
        return <DatabaseViewPreview />;
      }
      if (blockType() === "divider") {
        return <div class="block-renderer block-renderer--divider" />;
      }
      if (blockType() === "image") {
        return renderImageDisplay(block.text);
      }
      if (blockType() === "todo") {
        const todoText = cleanTextForBlockType(block.text, "todo");
        if (!todoText.trim()) {
          return (
            <span class="block__placeholder">Write something...</span>
          );
        }
        return renderMarkdownDisplay(todoText);
      }
      const plugin = pluginRenderer();
      if (plugin) {
        return (
          <PluginBlockPreview
            block={block}
            renderer={plugin}
            isTauri={isTauri}
            onUpdateText={updateBlockText}
          />
        );
      }
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
        } ${args.collapsed ? "is-collapsed" : ""} ${
          isSelected() ? "is-selected" : ""
        } block--type-${blockType()} ${
          isDragSource() ? "is-drag-source" : ""
        } ${
          blockDropPosition() ? `is-drop-${blockDropPosition()}` : ""
        } ${args.isColumnRow ? "column-layout-preview__row" : ""}`}
        ref={observeBlock}
        data-block-id={block.id}
        data-row-block-id={args.isColumnRow ? block.id : undefined}
        data-depth={args.isColumnRow ? args.visualIndent : undefined}
        style={{
          "margin-left": `${args.visualIndent * 24}px`,
          "--block-indent": `${args.visualIndent * 24}px`,
          "--i": `${visibleIndex() >= 0 ? visibleIndex() : actualIndex}`
        }}
        onDragOver={(event) =>
          args.isColumnRow
            ? handleColumnRowDragOver(event, block.id)
            : handleBlockDragOver(event, block.id)
        }
        onDrop={(event) =>
          args.isColumnRow
            ? handleColumnRowDrop(event, block.id)
            : handleBlockDrop(event, block.id)
        }
      >
        <button
          class="block__drag-handle"
          type="button"
          draggable={true}
          aria-label="Drag block"
          onPointerDown={(event) =>
            startHandlePointerDrag(event, block.id)
          }
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragStart={(event) =>
            handleBlockHandleDragStart(event, block.id)
          }
          onDragEnd={clearBlockDragState}
        >
          <span class="block__drag-handle-dots" aria-hidden="true" />
        </button>
        <Show
          when={args.hasChildren || blockType() === "toggle"}
          fallback={
            <span
              class="block__toggle-spacer"
              aria-hidden="true"
            />
          }
        >
          <button
            class={`block__toggle ${
              args.collapsed ? "is-collapsed" : "is-expanded"
            }`}
            type="button"
            aria-label={args.collapsed ? "Expand block" : "Collapse block"}
            aria-expanded={!args.collapsed}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              toggleCollapse({
                block,
                index: actualIndex,
                indent: block.indent,
                parentIndex: null,
                hasChildren: args.hasChildren,
                collapsed: args.collapsed,
                hidden: false
              });
            }}
          />
        </Show>
        <Show
          when={blockType() === "todo"}
          fallback={<span class="block__bullet" aria-hidden="true" />}
        >
          <button
            class={`block__todo-check ${
              isTodoChecked(block.text) ? "is-checked" : ""
            }`}
            type="button"
            aria-label={
              isTodoChecked(block.text)
                ? "Mark to-do as incomplete"
                : "Mark to-do as complete"
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleTodoAt(actualIndex);
            }}
          />
        </Show>
        <div class="block__body">
          <textarea
            ref={(el) => inputRefs.set(block.id, el)}
            class={`block__input block__input--${blockType()}`}
            rows={1}
            data-block-id={block.id}
            value={block.text}
            placeholder="Write something..."
            spellcheck={true}
            style={{ display: isEditing() ? "block" : "none" }}
            aria-hidden={!isEditing()}
            onFocus={() => {
              if (selectionRange()) {
                clearSelection();
              }
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
              setBlocks(actualIndex, (prev) => ({
                ...prev,
                text: event.currentTarget.value
              }));
              scheduleSave();
              storeSelection(block.id, event.currentTarget);
              const value = event.currentTarget.value;
              const slashIndex = value.lastIndexOf("/");
              const isSlash = slashIndex === value.length - 1;
              if (isSlash) {
                openSlashMenu(
                  block,
                  actualIndex,
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
                actualIndex,
                event.currentTarget
              );
            }}
            onKeyDown={(event) => handleKeyDown(block, actualIndex, event)}
            onKeyUp={(event) => {
              storeSelection(block.id, event.currentTarget);
              if (event.key === "/") {
                const value = event.currentTarget.value;
                const slashIndex = value.lastIndexOf("/");
                const isSlash = slashIndex === value.length - 1;
                if (isSlash) {
                  openSlashMenu(
                    block,
                    actualIndex,
                    event.currentTarget,
                    slashIndex
                  );
                }
              }
            }}
            onSelect={(event) => storeSelection(block.id, event.currentTarget)}
          />
          <div
            class={`block__display block__display--${blockType()}`}
            style={{ display: isEditing() ? "none" : "block" }}
            onClick={(event) => {
              if (args.isColumnRow) {
                event.stopPropagation();
              }
              if (blockType() === "column_layout") {
                const target = event.target;
                if (target instanceof HTMLElement) {
                  const directRow = target.closest<HTMLElement>("[data-row-block-id]");
                  const directRowId = directRow?.dataset.rowBlockId;
                  if (directRowId) {
                    focusBlock(directRowId, "end");
                    return;
                  }
                  const column = target.closest<HTMLElement>(".column-layout-preview__column");
                  const firstInColumn = column?.querySelector<HTMLElement>("[data-row-block-id]");
                  const firstInColumnId = firstInColumn?.dataset.rowBlockId;
                  if (firstInColumnId) {
                    focusBlock(firstInColumnId, "end");
                    return;
                  }
                }
                const current = event.currentTarget;
                if (current instanceof HTMLElement) {
                  const firstRow = current.querySelector<HTMLElement>("[data-row-block-id]");
                  const firstRowId = firstRow?.dataset.rowBlockId;
                  if (firstRowId) {
                    focusBlock(firstRowId, "end");
                  }
                }
                return;
              }
              if (event.shiftKey && visibleIndex() >= 0) {
                applyShiftSelection(visibleIndex());
                return;
              }
              if (selectionRange()) {
                clearSelection();
              }
              const preserve =
                activeId() === block.id &&
                caretPositions.has(block.id);
              focusBlock(block.id, preserve ? "preserve" : "end");
            }}
          >
            {displayContent()}
          </div>
          <Show when={isEditing() && pluginRenderer()}>
            {(renderer) => (
              <PluginBlockPreview
                block={block}
                renderer={renderer()}
                isTauri={isTauri}
                onUpdateText={updateBlockText}
              />
            )}
          </Show>
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
  };

  const requestRename = () => {
    openRenameDialog();
  };

  return (
    <section class="editor-pane">
      <div class="editor-pane__header">
        <div class="editor-pane__title-group">
          <div class="editor-pane__title-row">
            <div class="editor-pane__title">{pageTitle()}</div>
            <div class="editor-pane__count">{blocks.length} blocks</div>
          </div>
          <Show when={breadcrumbItems().length > 1}>
            <div class="editor-pane__breadcrumb" aria-label="Block breadcrumb">
              <For each={breadcrumbItems()}>
                {(item, index) => {
                  const isLast = () =>
                    index() === breadcrumbItems().length - 1;
                  return (
                    <div class="editor-pane__breadcrumb-item">
                      <button
                        class={`editor-pane__breadcrumb-button ${
                          isLast() ? "is-current" : ""
                        }`}
                        type="button"
                        aria-current={isLast() ? "true" : undefined}
                        onClick={() => focusBlock(item.block.id, "end")}
                      >
                        {formatBreadcrumbLabel(item.block.text)}
                      </button>
                      <Show when={!isLast()}>
                        <span class="editor-pane__breadcrumb-sep">/</span>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
        <div class="editor-pane__actions">
          <Show when={selectionRange()}>
            <div class="editor-pane__selection">
              <span class="editor-pane__selection-count">
                {selectionCount()} selected
              </span>
              <div class="editor-pane__selection-actions">
                <button
                  class="editor-pane__action"
                  type="button"
                  onClick={duplicateSelection}
                >
                  Duplicate
                </button>
                <button
                  class="editor-pane__action"
                  type="button"
                  onClick={() => adjustSelectionIndent(1)}
                >
                  Indent
                </button>
                <button
                  class="editor-pane__action"
                  type="button"
                  onClick={() => adjustSelectionIndent(-1)}
                >
                  Outdent
                </button>
                <button
                  class="editor-pane__action"
                  type="button"
                  onClick={removeSelection}
                >
                  Delete
                </button>
              </div>
            </div>
          </Show>
          <button
            class="editor-pane__action"
            onClick={requestRename}
            disabled={pageBusy()}
          >
            {pageBusy() ? "Renaming..." : "Rename"}
          </button>
          <div class="editor-pane__outline">
            <button
              class="editor-pane__action"
              type="button"
              onClick={() => setOutlineMenuOpen((prev) => !prev)}
            >
              Outline
            </button>
            <Show when={outlineMenuOpen()}>
              <div
                class="editor-outline-menu"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div class="editor-outline-menu__section">
                  <button
                    class="editor-outline-menu__action"
                    type="button"
                    onClick={() => {
                      foldToLevel(0);
                      setOutlineMenuOpen(false);
                    }}
                  >
                    Fold all
                  </button>
                  <button
                    class="editor-outline-menu__action"
                    type="button"
                    onClick={() => {
                      foldToLevel(1);
                      setOutlineMenuOpen(false);
                    }}
                  >
                    Fold to level 1
                  </button>
                  <button
                    class="editor-outline-menu__action"
                    type="button"
                    onClick={() => {
                      foldToLevel(2);
                      setOutlineMenuOpen(false);
                    }}
                  >
                    Fold to level 2
                  </button>
                  <button
                    class="editor-outline-menu__action"
                    type="button"
                    onClick={() => {
                      unfoldAll();
                      setOutlineMenuOpen(false);
                    }}
                  >
                    Unfold all
                  </button>
                </div>
                <div class="editor-outline-menu__list">
                  <For each={outline().visible}>
                    {(item) => (
                      <button
                        class={`editor-outline-menu__item ${
                          activeId() === item.block.id ? "is-active" : ""
                        }`}
                        type="button"
                        style={{ "padding-left": `${item.indent * 12 + 8}px` }}
                        onClick={() => {
                          focusBlock(item.block.id, "end");
                          setOutlineMenuOpen(false);
                        }}
                      >
                        {formatBreadcrumbLabel(item.block.text)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
      <div
        class="editor-pane__body"
        ref={editorRef}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        onClick={handleBodyClick}
        onContextMenu={handleContextMenu}
      >
        <Show when={dragBox()}>
          {(box) => (
            <div
              class="block-selection-box"
              style={{
                top: `${box().top}px`,
                height: `${box().height}px`
              }}
            />
          )}
        </Show>
        <Show when={contextMenu()}>
          {(menu) => (
            <div
              class="block-selection-menu"
              style={{
                top: `${menu().y}px`,
                left: `${menu().x}px`
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                class="block-selection-menu__item"
                data-action="duplicate"
                type="button"
                onClick={() => {
                  duplicateSelection();
                  setContextMenu(null);
                }}
              >
                Duplicate
              </button>
              <button
                class="block-selection-menu__item"
                data-action="indent"
                type="button"
                onClick={() => {
                  adjustSelectionIndent(1);
                  setContextMenu(null);
                }}
              >
                Indent
              </button>
              <button
                class="block-selection-menu__item"
                data-action="outdent"
                type="button"
                onClick={() => {
                  adjustSelectionIndent(-1);
                  setContextMenu(null);
                }}
              >
                Outdent
              </button>
              <button
                class="block-selection-menu__item"
                data-action="delete"
                type="button"
                onClick={() => {
                  removeSelection();
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
              <button
                class="block-selection-menu__item"
                data-action="clear"
                type="button"
                onClick={() => {
                  clearSelection();
                  setContextMenu(null);
                }}
              >
                Clear selection
              </button>
            </div>
          )}
        </Show>
        <div class="virtual-space" style={{ height: `${range().totalHeight}px` }}>
          <div
            class="virtual-list"
            style={{ transform: `translateY(${range().offset}px)` }}
          >
            <For each={visibleBlocks()}>
              {(item, index) => {
                // eslint-disable-next-line solid/reactivity
                const visibleIndex = range().start + index();
                return renderBlockRow({
                  block: item.block,
                  actualIndex: item.index,
                  visibleIndex,
                  hasChildren: item.hasChildren,
                  collapsed: item.collapsed,
                  visualIndent: item.block.indent
                });
              }}
            </For>
          </div>
        </div>
        <SlashMenu
          open={slashMenu().open}
          position={slashMenu().position}
          onSelect={applySlashCommand}
        />
        <WikilinkMenu
          open={wikilinkMenu().open}
          position={wikilinkMenu().position}
          matches={wikilinkMatches()}
          activePageUid={activePageUid()}
          resolvePageUid={resolvePageUid}
          createLabel={wikilinkCreateLabel()}
          query={wikilinkQuery()}
          onSelect={(title) => applyWikilinkSuggestion(title)}
          onCreate={(title) => applyWikilinkSuggestion(title, true)}
        />
        <LinkPreview
          open={linkPreview().open}
          position={linkPreview().position}
          title={linkPreview().title}
          blocks={linkPreview().blocks}
          loading={linkPreview().loading}
          onOpen={() => void openPageByTitle(linkPreview().title)}
          onMouseEnter={() => cancelLinkPreviewClose()}
          onMouseLeave={() => scheduleLinkPreviewClose()}
        />
        <ConfirmDialog
          open={dialogOpen}
          title={dialogTitle()}
          confirmLabel={dialogConfirmLabel()}
          onConfirm={confirmDialog}
          onCancel={closeDialog}
          confirmDisabled={dialogDisabled}
        >
          <input
            class="modal__input"
            type="text"
            placeholder={
              dialogMode() === "rename" ? "Page title" : "Link target"
            }
            value={dialogValue()}
            onInput={(event) => setDialogValue(event.currentTarget.value)}
          />
        </ConfirmDialog>
      </div>
    </section>
  );
};
