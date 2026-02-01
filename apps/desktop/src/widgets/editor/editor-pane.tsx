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
import type { Block } from "../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../../entities/page/model/page-types";
import type { PageId } from "../../shared/model/id-types";
import type { PluginRenderer } from "../../entities/plugin/model/plugin-types";
import type { CodeFence } from "../../shared/model/markdown-types";
import type { CaretPosition } from "../../shared/model/position";
import { BlockActions } from "../../features/editor/ui/block-actions";
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
import { getCaretPosition } from "../../shared/lib/textarea/get-caret-position";
import { getVirtualRange } from "../../shared/lib/virtual-list/virtual-list";

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
  createNewBlock: (text?: string, indent?: number) => Block;
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
  const addReviewItem = props.addReviewItem;
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
  const inputRefs = new Map<string, HTMLTextAreaElement>();
  const caretPositions = new Map<string, { start: number; end: number }>();
  const previewCache = new Map<string, { title: string; blocks: string[] }>();
  let editorRef: HTMLDivElement | undefined;
  let copyTimeout: number | undefined;
  let previewCloseTimeout: number | undefined;

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
    if (previewCloseTimeout) {
      window.clearTimeout(previewCloseTimeout);
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
    setActiveId(block.id);
    setFocusedId(block.id);
    setJumpTarget({ id: block.id, caret: "start" });
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
    setActiveId(clone.id);
    setFocusedId(clone.id);
    setJumpTarget({ id: clone.id, caret: "end" });
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

  const openLinkDialog = (block: Block, index: number) => {
    setDialogMode("link");
    setDialogTarget({ id: block.id, index });
    setDialogValue("");
    setDialogOpen(true);
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

  const requestRename = () => {
    openRenameDialog();
  };

  return (
    <section class="editor-pane">
      <div class="editor-pane__header">
        <div class="editor-pane__title-group">
          <div class="editor-pane__title">{pageTitle()}</div>
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
                const pluginRenderer = () => getPluginBlockRenderer(block.text);
                const isEditing = () => focusedId() === block.id;
                const updateBlockText = (nextText: string) => {
                  if (nextText === block.text) return;
                  const index = findIndexById(block.id);
                  if (index < 0) return;
                  setBlocks(index, "text", nextText);
                  scheduleSave();
                };
                const displayContent = () => {
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
                    }`}
                    ref={observeBlock}
                    data-block-id={block.id}
                    style={{
                      "margin-left": `${block.indent * 24}px`,
                      "--i": `${blockIndex()}`
                    }}
                  >
                    <BlockActions
                      onAddReview={() => addReviewFromBlock(block)}
                      onLinkToPage={() => openLinkDialog(block, blockIndex())}
                      onDuplicate={() => duplicateBlockAt(blockIndex())}
                    />
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
