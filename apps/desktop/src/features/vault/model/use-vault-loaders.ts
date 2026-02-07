import type { Accessor, Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageBlocksResponse,
  PageSummary
} from "../../../entities/page/model/page-types";
import type { PageId } from "../../../shared/model/id-types";
import type {
  ReviewQueueItem,
  ReviewQueueSummary
} from "../../../entities/review/model/review-types";
import type { VaultRecord } from "../../../entities/vault/model/vault-types";
import { readLocalStorage } from "../../../shared/lib/storage/safe-local-storage";
import { resolveBlockType } from "../../../shared/lib/blocks/block-type-utils";

export type VaultLoaderDependencies = {
  isTauri: () => boolean;
  invoke: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
  localPages: Record<PageId, LocalPageRecord>;
  setPages: Setter<PageSummary[]>;
  activePageUid: Accessor<PageId>;
  setActivePageUid: Setter<PageId>;
  activeVault: Accessor<VaultRecord | null>;
  resolvePageUid: (value: string) => PageId;
  snapshotBlocks: (items: Block[]) => Block[];
  saveLocalPageSnapshot: (pageUid: PageId, title: string, items: Block[]) => void;
  buildLocalDefaults: () => Block[];
  buildEmptyBlocks: (idFactory: () => string) => Block[];
  buildDefaultBlocks: (idFactory: () => string) => Block[];
  makeLocalId: () => string;
  makeRandomId: () => string;
  setBlocks: SetStoreFunction<Block[]>;
  setPageTitle: Setter<string>;
  setRenameTitle: Setter<string>;
  setActiveId: Setter<string | null>;
  setFocusedId: Setter<string | null>;
  markSaved: () => void;
  toPayload: (block: Block) => BlockPayload;
  serializePageToMarkdown: (page: {
    id: string;
    title: string;
    blocks: Array<{
      id: string;
      text: string;
      indent: number;
      block_type?: Block["block_type"];
    }>;
  }) => string;
  shadowWriter: { scheduleWrite: (pageUid: PageId, content: string) => void };
  setReviewSummary: Setter<ReviewQueueSummary>;
  setReviewItems: Setter<ReviewQueueItem[]>;
  setReviewBusy: Setter<boolean>;
  defaultPageUid: PageId;
};

export const createVaultLoaders = (deps: VaultLoaderDependencies) => {
  const loadPages = async () => {
    if (!deps.isTauri()) {
      const entries = Object.values(deps.localPages)
        .map((page) => ({ uid: page.uid, title: page.title }))
        .sort((left, right) => left.title.localeCompare(right.title));
      deps.setPages(entries);
      if (
        entries.length > 0 &&
        !entries.find(
          (page) => page.uid === deps.resolvePageUid(deps.activePageUid())
        )
      ) {
        deps.setActivePageUid(entries[0]?.uid ?? deps.defaultPageUid);
      }
      return;
    }

    try {
      const remote = (await deps.invoke("list_pages")) as PageSummary[];
      deps.setPages(remote);
      if (
        remote.length > 0 &&
        !remote.find(
          (page) => page.uid === deps.resolvePageUid(deps.activePageUid())
        )
      ) {
        deps.setActivePageUid(remote[0]?.uid ?? deps.defaultPageUid);
      }
    } catch (error) {
      console.error("Failed to load pages", error);
    }
  };

  const loadActivePage = async () => {
    const vaultId = deps.activeVault()?.id;
    if (!vaultId) return;
    if (!deps.isTauri()) {
      const stored = readLocalStorage(`sandpaper:active-page:${vaultId}`);
      if (stored) {
        deps.setActivePageUid(deps.resolvePageUid(stored));
      }
      return;
    }
    try {
      const stored = (await deps.invoke("get_active_page")) as string | null;
      if (stored) {
        deps.setActivePageUid(deps.resolvePageUid(stored));
      }
    } catch (error) {
      console.error("Failed to load active page", error);
    }
  };

  const loadReviewSummary = async () => {
    if (!deps.isTauri()) {
      deps.setReviewSummary({ due_count: 0, next_due_at: null });
      return;
    }
    try {
      const summary = (await deps.invoke(
        "review_queue_summary"
      )) as ReviewQueueSummary;
      deps.setReviewSummary(summary);
    } catch (error) {
      console.error("Failed to load review summary", error);
    }
  };

  const loadReviewQueue = async () => {
    if (!deps.isTauri()) {
      deps.setReviewItems([]);
      return;
    }
    deps.setReviewBusy(true);
    try {
      const items = (await deps.invoke("list_review_queue_due", {
        limit: 12
      })) as ReviewQueueItem[];
      deps.setReviewItems(items);
    } catch (error) {
      console.error("Failed to load review queue", error);
    } finally {
      deps.setReviewBusy(false);
    }
  };

  const loadBlocks = async (pageUid = deps.activePageUid()) => {
    const resolvedUid = deps.resolvePageUid(pageUid);
    deps.setActivePageUid(resolvedUid);
    deps.setFocusedId(null);

    if (!deps.isTauri()) {
      const local = deps.localPages[resolvedUid];
      if (!local) {
        const seeded =
          resolvedUid === deps.defaultPageUid
            ? deps.buildLocalDefaults()
            : deps.buildEmptyBlocks(deps.makeLocalId);
        const title =
          resolvedUid === deps.defaultPageUid ? "Inbox" : "Untitled";
        deps.saveLocalPageSnapshot(resolvedUid, title, seeded);
        deps.setBlocks(seeded);
        deps.setPageTitle(title);
        deps.setRenameTitle(title);
        deps.setActiveId(seeded[0]?.id ?? null);
        deps.markSaved();
        await loadPages();
        return;
      }
      deps.setBlocks(deps.snapshotBlocks(local.blocks));
      const localTitle = local.title || "Untitled";
      deps.setPageTitle(localTitle);
      deps.setRenameTitle(localTitle);
      deps.setActiveId(local.blocks[0]?.id ?? null);
      deps.markSaved();
      return;
    }

    try {
      const response = (await deps.invoke("load_page_blocks", {
        pageUid: resolvedUid,
        page_uid: resolvedUid
      })) as PageBlocksResponse;
      const loaded = response.blocks.map((block) => ({
        id: block.uid,
        text: block.text,
        indent: block.indent,
        block_type: resolveBlockType({ text: block.text, block_type: block.block_type })
      }));
      const title =
        response.title ||
        (resolvedUid === deps.defaultPageUid ? "Inbox" : "Untitled");
      deps.setPageTitle(title);
      deps.setRenameTitle(title);
      if (loaded.length === 0) {
        const seeded = deps.buildDefaultBlocks(deps.makeRandomId);
        deps.setBlocks(seeded);
        await deps.invoke("save_page_blocks", {
          pageUid: resolvedUid,
          page_uid: resolvedUid,
          blocks: seeded.map((block) => deps.toPayload(block))
        });
        const seedMarkdown = deps.serializePageToMarkdown({
          id: resolvedUid,
          title,
          blocks: seeded.map((block) => ({
            id: block.id,
            text: block.text,
            indent: block.indent,
            block_type: resolveBlockType(block)
          }))
        });
        deps.shadowWriter.scheduleWrite(resolvedUid, seedMarkdown);
        deps.setActiveId(seeded[0]?.id ?? null);
        deps.markSaved();
        return;
      }
      deps.setBlocks(loaded);
      deps.setActiveId(loaded[0]?.id ?? null);
      const loadedMarkdown = deps.serializePageToMarkdown({
        id: resolvedUid,
        title,
        blocks: loaded.map((block) => ({
          id: block.id,
          text: block.text,
          indent: block.indent,
          block_type: resolveBlockType(block)
        }))
      });
      deps.shadowWriter.scheduleWrite(resolvedUid, loadedMarkdown);
      deps.markSaved();
    } catch (error) {
      console.error("Failed to load blocks", error);
      deps.setBlocks(deps.buildLocalDefaults());
      deps.setPageTitle("Inbox");
      deps.setRenameTitle("Inbox");
      deps.markSaved();
    }
  };

  return {
    loadPages,
    loadActivePage,
    loadReviewSummary,
    loadReviewQueue,
    loadBlocks
  };
};
