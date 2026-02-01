import {
  createMemo,
  createResource,
  type Accessor,
  type Setter
} from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import { buildBacklinks, buildWikilinkBacklinks } from "@sandpaper/core-model";
import type { Block } from "../../../entities/block/model/block-types";
import type {
  BacklinkEntry,
  PageBacklinkRecord,
  PageLinkBlock,
  UnlinkedReference
} from "../../../entities/page/model/backlink-types";
import type {
  LocalPageRecord,
  PageSummary
} from "../../../entities/page/model/page-types";
import { escapeRegExp } from "../../../shared/lib/string/escape-regexp";
import { formatBacklinkSnippet, stripWikilinks } from "./page-utils";
import { groupPageBacklinks } from "./backlink-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type JumpTarget = {
  id: string;
  caret: "start" | "end" | "preserve";
};

type BacklinksDeps = {
  blocks: Accessor<Block[]>;
  setBlocks: SetStoreFunction<Block[]>;
  pages: Accessor<PageSummary[]>;
  localPages: Record<string, LocalPageRecord>;
  activePageUid: Accessor<string>;
  activeId: Accessor<string | null>;
  pageTitle: Accessor<string>;
  isTauri: () => boolean;
  invoke: InvokeFn;
  resolvePageUid: (value: string) => string;
  scheduleSave: () => void;
  setActiveId: Setter<string | null>;
  setJumpTarget: Setter<JumpTarget | null>;
  switchPage: (pageUid: string) => Promise<void>;
  defaultPageUid: string;
};

export const createBacklinksState = (deps: BacklinksDeps) => {
  const backlinksMap = createMemo(() =>
    buildBacklinks(
      deps.blocks().map((block) => ({
        id: block.id,
        text: block.text
      }))
    )
  );

  const pageLinkBlocks = createMemo<PageLinkBlock[]>(() => {
    if (!deps.isTauri()) {
      const currentUid = deps.resolvePageUid(
        deps.activePageUid() || deps.defaultPageUid
      );
      const currentTitle = deps.pageTitle();
      const currentBlocks = deps.blocks().map((block) => ({
        id: block.id,
        text: block.text,
        pageUid: currentUid,
        pageTitle: currentTitle
      }));
      const otherBlocks = Object.values(deps.localPages).flatMap((page) => {
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
    const activeUid = deps.resolvePageUid(
      deps.activePageUid() || deps.defaultPageUid
    );
    const activeTitle = deps.pageTitle();
    return deps.blocks().map((block) => ({
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
    buildWikilinkBacklinks(pageLinkBlocks(), deps.resolvePageUid)
  );

  const [remotePageBacklinks] = createResource(
    deps.activePageUid,
    async (pageUid) => {
      if (!deps.isTauri()) return [];
      const resolved = deps.resolvePageUid(pageUid || deps.defaultPageUid);
      try {
        return (await deps.invoke("list_page_wikilink_backlinks", {
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
    () => deps.blocks().find((block) => block.id === deps.activeId()) ?? null
  );

  const activeBacklinks = createMemo<BacklinkEntry[]>(() => {
    const active = deps.activeId();
    if (!active) return [];
    const linked = backlinksMap()[active] ?? [];
    return linked
      .map((id) => deps.blocks().find((block) => block.id === id))
      .filter((block): block is Block => Boolean(block))
      .map((block) => ({ id: block.id, text: block.text || "Untitled" }));
  });

  const activePageBacklinks = createMemo<BacklinkEntry[]>(() => {
    if (deps.isTauri()) {
      return remotePageBacklinks().map((entry) => ({
        id: entry.block_uid,
        text: entry.text || "Untitled",
        pageUid: entry.page_uid,
        pageTitle: entry.page_title
      }));
    }
    const pageUid = deps.resolvePageUid(
      deps.activePageUid() || deps.defaultPageUid
    );
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

  const groupedPageBacklinks = createMemo(() =>
    groupPageBacklinks(
      activePageBacklinks(),
      deps.activePageUid() || deps.defaultPageUid,
      deps.resolvePageUid
    )
  );

  const openPageBacklink = async (entry: BacklinkEntry) => {
    const targetPage = entry.pageUid ?? deps.activePageUid();
    if (!targetPage) return;
    const currentUid = deps.resolvePageUid(
      deps.activePageUid() || deps.defaultPageUid
    );
    const targetUid = deps.resolvePageUid(targetPage);
    if (targetUid !== currentUid) {
      await deps.switchPage(targetPage);
    }
    deps.setActiveId(entry.id);
    deps.setJumpTarget({ id: entry.id, caret: "start" });
  };

  const supportsMultiPane = false;

  const openPageBacklinkInPane = async (entry: BacklinkEntry) => {
    if (!supportsMultiPane) return;
    await openPageBacklink(entry);
  };

  const unlinkedReferences = createMemo<UnlinkedReference[]>(() => {
    const currentUid = deps.resolvePageUid(deps.activePageUid());
    const availablePages = deps.pages().filter(
      (page) =>
        page.title &&
        deps.resolvePageUid(page.uid) !== currentUid &&
        page.title.trim().length > 0
    );
    if (availablePages.length === 0) return [];
    const refs: UnlinkedReference[] = [];
    const seen = new Set<string>();
    deps.blocks().forEach((block, index) => {
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
    const block = deps.blocks()[ref.blockIndex];
    if (!block || block.id !== ref.blockId) return;
    const pattern = new RegExp(escapeRegExp(ref.pageTitle), "i");
    const nextText = block.text.replace(pattern, `[[${ref.pageTitle}]]`);
    if (nextText === block.text) return;
    deps.setBlocks(ref.blockIndex, "text", nextText);
    deps.scheduleSave();
    deps.setActiveId(ref.blockId);
    deps.setJumpTarget({ id: ref.blockId, caret: "end" });
  };

  return {
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
  };
};
