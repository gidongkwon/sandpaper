import { createSignal, type Accessor, type Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import { normalizePageUid } from "../../../shared/lib/page/normalize-page-uid";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../../../entities/page/model/page-types";
import type { VaultRecord } from "../../../entities/vault/model/vault-types";
import { writeLocalStorage } from "../../../shared/lib/storage/safe-local-storage";
import { formatDailyNoteTitle, resolveUniqueLocalPageUid } from "./page-utils";
import { updateBlocksWithWikilinks } from "./page-ops-utils";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type PageOpsDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  pages: Accessor<PageSummary[]>;
  localPages: Record<string, LocalPageRecord>;
  setLocalPages: SetStoreFunction<Record<string, LocalPageRecord>>;
  blocks: Accessor<Block[]>;
  setBlocks: SetStoreFunction<Block[]>;
  activePageUid: Accessor<string>;
  setActivePageUid: Setter<string>;
  activeVault: Accessor<VaultRecord | null>;
  resolvePageUid: (value: string) => string;
  loadPages: () => Promise<void>;
  loadBlocks: (pageUid: string) => Promise<void>;
  saveLocalPageSnapshot: (pageUid: string, title: string, items: Block[]) => void;
  buildEmptyBlocks: (makeId: () => string) => Block[];
  makeLocalId: () => string;
  cancelPendingSave: (pageUid: string) => void;
  toPayload: (block: Block) => BlockPayload;
  defaultPageUid: string;
  state?: {
    pageTitle: Accessor<string>;
    setPageTitle: Setter<string>;
    pageMessage: Accessor<string | null>;
    setPageMessage: Setter<string | null>;
    pageBusy: Accessor<boolean>;
    setPageBusy: Setter<boolean>;
    newPageTitle: Accessor<string>;
    setNewPageTitle: Setter<string>;
    renameTitle: Accessor<string>;
    setRenameTitle: Setter<string>;
  };
};

export const createPageOps = (deps: PageOpsDeps) => {
  const [internalPageTitle, setInternalPageTitle] = createSignal("Inbox");
  const [internalPageMessage, setInternalPageMessage] =
    createSignal<string | null>(null);
  const [internalPageBusy, setInternalPageBusy] = createSignal(false);
  const [internalNewPageTitle, setInternalNewPageTitle] = createSignal("");
  const [internalRenameTitle, setInternalRenameTitle] = createSignal("");

  const pageTitle = deps.state?.pageTitle ?? internalPageTitle;
  const setPageTitle = deps.state?.setPageTitle ?? setInternalPageTitle;
  const pageMessage = deps.state?.pageMessage ?? internalPageMessage;
  const setPageMessage =
    deps.state?.setPageMessage ?? setInternalPageMessage;
  const pageBusy = deps.state?.pageBusy ?? internalPageBusy;
  const setPageBusy = deps.state?.setPageBusy ?? setInternalPageBusy;
  const newPageTitle = deps.state?.newPageTitle ?? internalNewPageTitle;
  const setNewPageTitle =
    deps.state?.setNewPageTitle ?? setInternalNewPageTitle;
  const renameTitle = deps.state?.renameTitle ?? internalRenameTitle;
  const setRenameTitle =
    deps.state?.setRenameTitle ?? setInternalRenameTitle;

  const persistActivePage = async (pageUid: string) => {
    const resolved = deps.resolvePageUid(pageUid);
    deps.setActivePageUid(resolved);
    const vaultId = deps.activeVault()?.id;
    if (!vaultId) return;
    if (!deps.isTauri()) {
      writeLocalStorage(`sandpaper:active-page:${vaultId}`, resolved);
      return;
    }
    try {
      await deps.invoke("set_active_page", {
        pageUid: resolved,
        page_uid: resolved
      });
    } catch (error) {
      console.error("Failed to persist active page", error);
    }
  };

  const switchPage = async (pageUid: string) => {
    const nextUid = deps.resolvePageUid(pageUid);
    if (nextUid === deps.resolvePageUid(deps.activePageUid())) return;

    if (!deps.isTauri()) {
      deps.saveLocalPageSnapshot(
        deps.activePageUid(),
        pageTitle(),
        deps.blocks()
      );
    }

    await persistActivePage(nextUid);
    await deps.loadBlocks(nextUid);
  };

  const ensureDailyNote = async () => {
    const title = formatDailyNoteTitle();
    const dailyUid = deps.resolvePageUid(title);
    if (!dailyUid) return;

    const exists = deps.pages().some((page) => {
      const pageUid = deps.resolvePageUid(page.uid);
      const titleUid = deps.resolvePageUid(page.title || "");
      return pageUid === dailyUid || titleUid === dailyUid;
    });
    if (exists) return;

    try {
      if (deps.isTauri()) {
        await deps.invoke("create_page", {
          payload: { title }
        });
      } else {
        const uid = resolveUniqueLocalPageUid(
          title,
          deps.localPages,
          deps.resolvePageUid
        );
        const seeded = deps.buildEmptyBlocks(deps.makeLocalId);
        deps.saveLocalPageSnapshot(uid, title, seeded);
      }
      await deps.loadPages();
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
      if (deps.isTauri()) {
        created = (await deps.invoke("create_page", {
          payload: { title }
        })) as PageSummary;
        await deps.loadPages();
      } else {
        const uid = resolveUniqueLocalPageUid(
          title,
          deps.localPages,
          deps.resolvePageUid
        );
        const seeded = deps.buildEmptyBlocks(deps.makeLocalId);
        deps.saveLocalPageSnapshot(uid, title, seeded);
        created = { uid, title };
        await deps.loadPages();
      }
      await persistActivePage(created.uid);
      await deps.loadBlocks(created.uid);
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
      if (deps.isTauri()) {
        created = (await deps.invoke("create_page", {
          payload: { title: trimmed }
        })) as PageSummary;
        await deps.loadPages();
      } else {
        const uid = resolveUniqueLocalPageUid(
          trimmed,
          deps.localPages,
          deps.resolvePageUid
        );
        const seeded = deps.buildEmptyBlocks(deps.makeLocalId);
        deps.saveLocalPageSnapshot(uid, trimmed, seeded);
        created = { uid, title: trimmed };
        await deps.loadPages();
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

    if (!deps.isTauri()) {
      const currentUid = deps.resolvePageUid(deps.activePageUid());
      Object.values(deps.localPages).forEach((page) => {
        const { updated, changed } = updateBlocksWithWikilinks(
          page.blocks,
          fromTitle,
          toTitle
        );
        if (!changed) return;
        deps.setLocalPages(page.uid, "blocks", updated);
        deps.cancelPendingSave(deps.resolvePageUid(page.uid));
        if (page.uid === currentUid) {
          deps.setBlocks(updated as Block[]);
        }
      });
      return;
    }

    const pageList = deps.pages().length
      ? deps.pages()
      : ((await deps.invoke("list_pages")) as PageSummary[]);
    for (const page of pageList) {
      const pageUid = deps.resolvePageUid(page.uid);
      if (pageUid === deps.resolvePageUid(deps.activePageUid())) {
        const { updated, changed } = updateBlocksWithWikilinks(
          deps.blocks(),
          fromTitle,
          toTitle
        );
        if (changed) {
          deps.setBlocks(updated as Block[]);
          await deps.invoke("save_page_blocks", {
            pageUid,
            page_uid: pageUid,
            blocks: updated.map((block) => deps.toPayload(block as Block))
          });
        }
        continue;
      }
      const response = (await deps.invoke("load_page_blocks", {
        pageUid,
        page_uid: pageUid
      })) as PageBlocksResponse;
      const { updated, changed } = updateBlocksWithWikilinks(
        response.blocks,
        fromTitle,
        toTitle
      );
      if (!changed) continue;
      await deps.invoke("save_page_blocks", {
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
    const pageUid = deps.resolvePageUid(deps.activePageUid());
    const previousTitle = pageTitle();
    try {
      if (deps.isTauri()) {
        const updated = (await deps.invoke("rename_page", {
          payload: {
            page_uid: pageUid,
            title
          }
        })) as PageSummary;
        setPageTitle(updated.title);
        await deps.loadPages();
      } else {
        if (deps.localPages[pageUid]) {
          deps.setLocalPages(pageUid, "title", title);
          setPageTitle(title);
        }
        await deps.loadPages();
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

  return {
    pageTitle,
    setPageTitle,
    pageMessage,
    setPageMessage,
    pageBusy,
    newPageTitle,
    setNewPageTitle,
    renameTitle,
    setRenameTitle,
    persistActivePage,
    switchPage,
    ensureDailyNote,
    createPage,
    createPageFromLink,
    renamePage,
    updateWikilinksAcrossPages
  };
};
