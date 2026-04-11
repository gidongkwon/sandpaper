import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Setter
} from "solid-js";
import type { Block } from "../../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageSummary
} from "../../../entities/page/model/page-types";
import type { PluginCommand } from "../../../entities/plugin/model/plugin-types";
import type { JumpTarget } from "../../../shared/model/jump-target";
import type { Mode } from "../../../shared/model/mode";
import {
  readLocalStorage,
  writeLocalStorage
} from "../../../shared/lib/storage/safe-local-storage";
import {
  buildCreatePageItem,
  buildPaletteCommands,
  commitRecentPageHistory,
  filterPaletteCommands,
  nextPaletteIndex,
  parsePaletteQuery,
  shouldPrioritizeCommands,
  type CommandPaletteItem,
  type CommandPaletteNoteItem
} from "./command-palette-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type NoteMatch = {
  id: string;
  title: string;
  snippet?: string;
  breadcrumb?: string | null;
  pageUid: string;
  blockUid?: string | null;
};

type CommandPaletteDeps = {
  mode: Accessor<Mode>;
  setMode: Setter<Mode>;
  sidebarOpen: Accessor<boolean>;
  setSidebarOpen: Setter<boolean>;
  backlinksOpen: Accessor<boolean>;
  setBacklinksOpen: Setter<boolean>;
  getSearchInput: () => HTMLInputElement | undefined;
  focusEditorSection: () => void;
  openNewPageDialog: () => void;
  createPageWithAllBlockTypes: () => void | Promise<void>;
  createPageFromTitle: (title: string) => void | Promise<void>;
  openRenamePageDialog: () => void;
  setSettingsOpen: (open: boolean) => void;
  syncConnected: Accessor<boolean>;
  syncNow: () => void | Promise<void>;
  pluginCommands: Accessor<PluginCommand[]>;
  runPluginCommand: (command: PluginCommand) => void | Promise<void>;
  isTauri: () => boolean;
  invoke: InvokeFn;
  pages: Accessor<PageSummary[]>;
  localPages: Accessor<Record<string, LocalPageRecord>>;
  blocks: Accessor<Block[]>;
  pageTitle: Accessor<string>;
  activePageUid: Accessor<string>;
  resolvePageUid: (value: string) => string;
  recentPagesKey: Accessor<string>;
  jumpToLocation: (target: {
    pageUid?: string | null;
    blockUid?: string | null;
    id?: string | null;
    caret?: JumpTarget["caret"];
  }) => void | Promise<void>;
};

const MAX_RECENT_NOTES = 5;
const MAX_FEATURED_COMMANDS = 5;
const MAX_NOTE_RESULTS = 7;
const MAX_COMMAND_RESULTS = 3;

const firstSnippetFromBlocks = (blocks: Block[]) =>
  blocks.find((block) => block.text.trim().length > 0)?.text.trim() ?? "";

const buildRecentNoteMatches = (
  recentPageUids: string[],
  deps: Pick<
    CommandPaletteDeps,
    "pages" | "localPages" | "blocks" | "pageTitle" | "activePageUid" | "resolvePageUid"
  >
): NoteMatch[] => {
  const currentPageUid = deps.resolvePageUid(deps.activePageUid());
  const pageTitleMap = new Map<string, string>();
  for (const page of deps.pages()) {
    pageTitleMap.set(deps.resolvePageUid(page.uid), page.title);
  }
  for (const page of Object.values(deps.localPages())) {
    pageTitleMap.set(deps.resolvePageUid(page.uid), page.title);
  }

  return recentPageUids
    .map((pageUid) => deps.resolvePageUid(pageUid))
    .filter(Boolean)
    .map((pageUid) => {
      const isCurrentPage = pageUid === currentPageUid;
      const localPage = deps.localPages()[pageUid];
      const title = isCurrentPage
        ? deps.pageTitle()
        : pageTitleMap.get(pageUid) ?? localPage?.title ?? "Untitled";
      const snippet = isCurrentPage
        ? firstSnippetFromBlocks(deps.blocks())
        : firstSnippetFromBlocks(localPage?.blocks ?? []);

      return {
        id: `recent-note:${pageUid}`,
        title,
        snippet: snippet || "Open page",
        breadcrumb: null,
        pageUid,
        blockUid: isCurrentPage
          ? deps.blocks()[0]?.id ?? null
          : localPage?.blocks[0]?.id ?? null
      } satisfies NoteMatch;
    })
    .filter((match) => match.title.trim().length > 0)
    .slice(0, MAX_RECENT_NOTES);
};

const searchLocalNotes = (
  term: string,
  deps: Pick<
    CommandPaletteDeps,
    "pages" | "localPages" | "blocks" | "pageTitle" | "activePageUid" | "resolvePageUid"
  >
): NoteMatch[] => {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];

  const currentPageUid = deps.resolvePageUid(deps.activePageUid());
  const candidates = [
    {
      pageUid: currentPageUid,
      title: deps.pageTitle(),
      blocks: deps.blocks()
    },
    ...Object.values(deps.localPages())
      .filter((page) => deps.resolvePageUid(page.uid) !== currentPageUid)
      .map((page) => ({
        pageUid: deps.resolvePageUid(page.uid),
        title: page.title,
        blocks: page.blocks
      }))
  ];

  return candidates
    .map((page) => {
      const normalizedTitle = page.title.toLowerCase();
      const titleScore =
        normalizedTitle === normalized
          ? 400
          : normalizedTitle.startsWith(normalized)
            ? 250
            : normalizedTitle.includes(normalized)
              ? 180
              : 0;
      const matchingBlock = page.blocks.find((block) =>
        block.text.toLowerCase().includes(normalized)
      );
      const blockScore = matchingBlock ? 160 : 0;
      const score = titleScore + blockScore;
      if (score <= 0) return null;

      return {
        id: matchingBlock?.id ?? `page:${page.pageUid}`,
        title: page.title,
        snippet: matchingBlock?.text.trim() || "Open page",
        breadcrumb: null,
        pageUid: page.pageUid,
        blockUid: matchingBlock?.id ?? null,
        score
      };
    })
    .filter((match): match is NoteMatch & { score: number } => Boolean(match))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_NOTE_RESULTS)
    .map(({ score: _score, ...match }) => match);
};

const buildNoteItem = (
  match: NoteMatch,
  jumpToLocation: CommandPaletteDeps["jumpToLocation"]
): CommandPaletteNoteItem => ({
  kind: "note",
  id: match.id,
  title: match.title,
  snippet: match.snippet,
  breadcrumb: match.breadcrumb,
  pageUid: match.pageUid,
  blockUid: match.blockUid ?? null,
  action: () =>
    jumpToLocation({
      pageUid: match.pageUid,
      blockUid: match.blockUid ?? null,
      id: match.id,
      caret: "start"
    })
});

export const createCommandPalette = (deps: CommandPaletteDeps) => {
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteQuery, setPaletteQuery] = createSignal("");
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  const [recentPageUids, setRecentPageUids] = createSignal<string[]>([]);
  let paletteInputRef: HTMLInputElement | undefined;

  const parsedQuery = createMemo(() => parsePaletteQuery(paletteQuery()));

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

  const paletteCommands = createMemo(() =>
    buildPaletteCommands({
      mode: deps.mode(),
      sidebarOpen: deps.sidebarOpen(),
      backlinksOpen: deps.backlinksOpen(),
      isTauri: deps.isTauri(),
      syncConnected: deps.syncConnected(),
      pluginCommands: deps.pluginCommands(),
      actions: {
        openSettings: () => deps.setSettingsOpen(true),
        switchToEditor: () => deps.setMode("editor"),
        switchToCapture: () => deps.setMode("quick-capture"),
        switchToRefine: () => deps.setMode("refine"),
        focusSearch: () => {
          if (!deps.sidebarOpen()) {
            deps.setSidebarOpen(true);
          }
          requestAnimationFrame(() => {
            deps.getSearchInput()?.focus();
          });
        },
        focusEditor: deps.focusEditorSection,
        newPage: deps.openNewPageDialog,
        newPageWithAllBlockTypes: () => void deps.createPageWithAllBlockTypes(),
        renamePage: deps.openRenamePageDialog,
        toggleBacklinks: () => deps.setBacklinksOpen((prev) => !prev),
        syncNow: () => void deps.syncNow(),
        runPluginCommand: (command) => void deps.runPluginCommand(command)
      }
    })
  );

  const filteredCommandItems = createMemo(() =>
    filterPaletteCommands(paletteCommands(), parsedQuery().term)
  );

  const localNoteMatches = createMemo(() => {
    if (parsedQuery().commandOnly) return [];
    if (!parsedQuery().term) {
      return buildRecentNoteMatches(recentPageUids(), deps);
    }
    return searchLocalNotes(parsedQuery().term, deps);
  });

  const [remoteNoteMatches] = createResource(
    () => ({
      term: parsedQuery().term,
      commandOnly: parsedQuery().commandOnly,
      enabled: deps.isTauri()
    }),
    async ({ term, commandOnly, enabled }) => {
      if (!enabled || commandOnly || !term) return [];
      try {
        const remote = (await deps.invoke("rag_search_hybrid", {
          payload: {
            query: term,
            limit: MAX_NOTE_RESULTS
          }
        })) as
          | Array<{
              page_uid: string;
              block_uid: string;
              chunk_id: string;
              title: string;
              breadcrumb?: string | null;
              snippet: string;
            }>
          | null;

        return (remote ?? []).map((hit) => ({
          id: hit.chunk_id || hit.block_uid,
          title: hit.title,
          snippet: hit.snippet,
          breadcrumb: hit.breadcrumb ?? null,
          pageUid: hit.page_uid,
          blockUid: hit.block_uid
        }));
      } catch (error) {
        console.error("Command palette note search failed", error);
        return [];
      }
    },
    { initialValue: [] as NoteMatch[] }
  );

  const noteItems = createMemo<CommandPaletteNoteItem[]>(() => {
    const matches =
      deps.isTauri() && parsedQuery().term && !parsedQuery().commandOnly
        ? remoteNoteMatches()
        : localNoteMatches();
    return matches.map((match) => buildNoteItem(match, deps.jumpToLocation));
  });

  const paletteItems = createMemo<CommandPaletteItem[]>(() => {
    const { commandOnly, term } = parsedQuery();
    if (commandOnly) {
      return term
        ? filteredCommandItems()
        : paletteCommands().slice(0, MAX_FEATURED_COMMANDS);
    }

    if (!term) {
      return [
        ...noteItems(),
        ...paletteCommands().slice(0, MAX_FEATURED_COMMANDS)
      ];
    }

    const notes = noteItems().slice(0, MAX_NOTE_RESULTS);
    const commands = filteredCommandItems().slice(0, MAX_COMMAND_RESULTS);
    const items = shouldPrioritizeCommands(filteredCommandItems(), term)
      ? [...commands, ...notes]
      : [...notes, ...commands];

    if (items.length > 0) {
      return items;
    }

    return [
      buildCreatePageItem(term, () => deps.createPageFromTitle(term))
    ];
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
    const items = paletteItems();
    if (items.length === 0) return;
    setPaletteIndex((current) => nextPaletteIndex(current, delta, items.length));
  };

  const registerPaletteInput = (el: HTMLInputElement) => {
    paletteInputRef = el;
    if (paletteOpen()) {
      queueMicrotask(() => el.focus());
    }
  };

  createEffect(() => {
    const key = deps.recentPagesKey();
    const stored = readLocalStorage(key);
    if (!stored) {
      setRecentPageUids([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      setRecentPageUids(Array.isArray(parsed) ? parsed : []);
    } catch {
      setRecentPageUids([]);
    }
  });

  createEffect(() => {
    const key = deps.recentPagesKey();
    writeLocalStorage(key, JSON.stringify(recentPageUids()));
  });

  createEffect(() => {
    const pageUid = deps.resolvePageUid(deps.activePageUid());
    if (!pageUid) return;
    setRecentPageUids((current) => commitRecentPageHistory(current, pageUid));
  });

  createEffect(() => {
    paletteQuery();
    setPaletteIndex(0);
  });

  createEffect(() => {
    const items = paletteItems();
    if (items.length === 0) {
      setPaletteIndex(0);
      return;
    }
    if (paletteIndex() >= items.length) {
      setPaletteIndex(items.length - 1);
    }
  });

  createEffect(() => {
    if (!paletteOpen()) return;
    requestAnimationFrame(() => {
      paletteInputRef?.focus();
      paletteInputRef?.select();
    });
  });

  onMount(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleGlobalKeydown);
    });
  });

  return {
    paletteOpen,
    paletteQuery,
    setPaletteQuery,
    paletteIndex,
    setPaletteIndex,
    paletteItems,
    closeCommandPalette,
    movePaletteIndex,
    runPaletteCommand,
    registerPaletteInput
  };
};
