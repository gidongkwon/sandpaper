import { createSignal, untrack } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "../../../entities/block/model/block-types";
import type {
  LocalPageRecord,
  PageSummary
} from "../../../entities/page/model/page-types";
import type { ReviewQueueItem, ReviewQueueSummary } from "../../../entities/review/model/review-types";
import type { VaultRecord } from "../../../entities/vault/model/vault-types";
import { createVaultLoaders } from "./use-vault-loaders";

describe("createVaultLoaders", () => {
  it("loads local pages and updates active page", async () => {
    const localPages: Record<string, LocalPageRecord> = {
      a: { uid: "a", title: "Alpha", blocks: [] },
      b: { uid: "b", title: "Beta", blocks: [] }
    };
    const [pages, setPages] = createSignal<PageSummary[]>([]);
    const [activePageUid, setActivePageUid] = createSignal("missing");
    const [activeVault] = createSignal<VaultRecord | null>(null);
    const [reviewSummary, setReviewSummary] = createSignal<ReviewQueueSummary>({
      due_count: 0,
      next_due_at: null
    });
    const [reviewItems, setReviewItems] = createSignal<ReviewQueueItem[]>([]);
    const [reviewBusy, setReviewBusy] = createSignal(false);

    const api = createVaultLoaders({
      isTauri: () => false,
      invoke: vi.fn(),
      localPages,
      setPages,
      activePageUid,
      setActivePageUid,
      activeVault,
      resolvePageUid: (value) => value,
      snapshotBlocks: (items) => items,
      saveLocalPageSnapshot: vi.fn(),
      buildLocalDefaults: () => [],
      buildEmptyBlocks: () => [],
      buildDefaultBlocks: () => [],
      makeLocalId: () => "local",
      makeRandomId: () => "rand",
      setBlocks: vi.fn(),
      setPageTitle: vi.fn(),
      setRenameTitle: vi.fn(),
      setActiveId: vi.fn(),
      setFocusedId: vi.fn(),
      markSaved: vi.fn(),
      toPayload: (block: Block) => ({
        uid: block.id,
        text: block.text,
        indent: block.indent
      }),
      serializePageToMarkdown: () => "",
      shadowWriter: { scheduleWrite: vi.fn() },
      setReviewSummary,
      setReviewItems,
      setReviewBusy,
      defaultPageUid: "inbox"
    });

    await api.loadPages();

    expect(untrack(pages)).toEqual([
      { uid: "a", title: "Alpha" },
      { uid: "b", title: "Beta" }
    ]);
    expect(untrack(activePageUid)).toBe("a");
    expect(untrack(reviewSummary)).toEqual({ due_count: 0, next_due_at: null });
    expect(untrack(reviewItems)).toEqual([]);
    expect(untrack(reviewBusy)).toBe(false);
  });

  it("seeds a missing local page and updates state", async () => {
    const localPages: Record<string, LocalPageRecord> = {};
    const [pages, setPages] = createSignal<PageSummary[]>([]);
    const [activePageUid, setActivePageUid] = createSignal("inbox");
    const [activeVault] = createSignal<VaultRecord | null>(null);
    const seeded: Block[] = [{ id: "seed", text: "", indent: 0 }];
    const saveLocalPageSnapshot = vi.fn();
    const setBlocks = vi.fn();
    const setPageTitle = vi.fn();
    const setRenameTitle = vi.fn();
    const setActiveId = vi.fn();
    const setFocusedId = vi.fn();
    const markSaved = vi.fn();

    const api = createVaultLoaders({
      isTauri: () => false,
      invoke: vi.fn(),
      localPages,
      setPages,
      activePageUid,
      setActivePageUid,
      activeVault,
      resolvePageUid: (value) => value,
      snapshotBlocks: (items) => items,
      saveLocalPageSnapshot,
      buildLocalDefaults: () => [],
      buildEmptyBlocks: () => seeded,
      buildDefaultBlocks: () => [],
      makeLocalId: () => "local",
      makeRandomId: () => "rand",
      setBlocks,
      setPageTitle,
      setRenameTitle,
      setActiveId,
      setFocusedId,
      markSaved,
      toPayload: (block: Block) => ({
        uid: block.id,
        text: block.text,
        indent: block.indent
      }),
      serializePageToMarkdown: () => "",
      shadowWriter: { scheduleWrite: vi.fn() },
      setReviewSummary: vi.fn(),
      setReviewItems: vi.fn(),
      setReviewBusy: vi.fn(),
      defaultPageUid: "inbox"
    });

    await api.loadBlocks("custom");

    expect(untrack(activePageUid)).toBe("custom");
    expect(untrack(pages)).toEqual([]);
    expect(saveLocalPageSnapshot).toHaveBeenCalledWith(
      "custom",
      "Untitled",
      seeded
    );
    expect(setBlocks).toHaveBeenCalledWith(seeded);
    expect(setPageTitle).toHaveBeenCalledWith("Untitled");
    expect(setRenameTitle).toHaveBeenCalledWith("Untitled");
    expect(setActiveId).toHaveBeenCalledWith("seed");
    expect(setFocusedId).toHaveBeenCalledWith(null);
    expect(markSaved).toHaveBeenCalled();
  });

  it("hydrates hidden inbox blocks into the local snapshot when loading from tauri", async () => {
    const localPages: Record<string, LocalPageRecord> = {
      inbox: { uid: "inbox", title: "Inbox", blocks: [] }
    };
    const [pages, setPages] = createSignal<PageSummary[]>([]);
    const [activePageUid, setActivePageUid] = createSignal("inbox");
    const [activeVault] = createSignal<VaultRecord | null>({
      id: "vault-1",
      name: "Vault",
      path: "/vault"
    });
    const saveLocalPageSnapshot = vi.fn();
    const setBlocks = vi.fn();
    const setPageTitle = vi.fn();
    const setRenameTitle = vi.fn();
    const setActiveId = vi.fn();
    const setFocusedId = vi.fn();
    const markSaved = vi.fn();

    const api = createVaultLoaders({
      isTauri: () => true,
      invoke: vi.fn(async (command) => {
        if (command === "load_page_blocks") {
          return {
            page_uid: "inbox",
            title: "Inbox",
            blocks: [{ uid: "capture-1", text: "Persisted capture", indent: 0 }]
          };
        }
        return null;
      }),
      localPages,
      setPages,
      activePageUid,
      setActivePageUid,
      activeVault,
      resolvePageUid: (value) => value,
      snapshotBlocks: (items) => items.map((item) => ({ ...item })),
      saveLocalPageSnapshot,
      buildLocalDefaults: () => [],
      buildEmptyBlocks: () => [],
      buildDefaultBlocks: () => [],
      makeLocalId: () => "local",
      makeRandomId: () => "rand",
      setBlocks,
      setPageTitle,
      setRenameTitle,
      setActiveId,
      setFocusedId,
      markSaved,
      toPayload: (block: Block) => ({
        uid: block.id,
        text: block.text,
        indent: block.indent
      }),
      serializePageToMarkdown: () => "",
      shadowWriter: { scheduleWrite: vi.fn() },
      setReviewSummary: vi.fn(),
      setReviewItems: vi.fn(),
      setReviewBusy: vi.fn(),
      defaultPageUid: "home"
    });

    await api.loadBlocks("inbox");

    expect(saveLocalPageSnapshot).toHaveBeenCalledWith("inbox", "Inbox", [
      { id: "capture-1", text: "Persisted capture", indent: 0, block_type: "text" }
    ]);
    expect(setBlocks).toHaveBeenCalledWith([
      { id: "capture-1", text: "Persisted capture", indent: 0, block_type: "text" }
    ]);
    expect(setPageTitle).toHaveBeenCalledWith("Inbox");
    expect(setRenameTitle).toHaveBeenCalledWith("Inbox");
    expect(setActiveId).toHaveBeenCalledWith("capture-1");
    expect(markSaved).toHaveBeenCalled();
    expect(untrack(pages)).toEqual([]);
  });
});
