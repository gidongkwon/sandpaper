import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../../entities/block/model/block-types";
import { createAutosave } from "./use-autosave";

describe("createAutosave", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    dispose?.();
    dispose = undefined;
  });

  const setup = () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const shadowWriter = { scheduleWrite: vi.fn() };
    const [activePageUid] = createSignal("page-1");
    const [pageTitle] = createSignal("Inbox");
    const blocks: Block[] = [
      { id: "block-1", text: "Hello", indent: 0 }
    ];

    let autosaveApi: ReturnType<typeof createAutosave> | undefined;
    createRoot((cleanup) => {
      dispose = cleanup;
      autosaveApi = createAutosave({
        isTauri: () => true,
        invoke,
        resolvePageUid: (uid) => uid,
        activePageUid,
        getBlocks: () => blocks,
        pageTitle,
        snapshotBlocks: (items) => items.map((block) => ({ ...block })),
        toPayload: (block) => ({
          uid: block.id,
          text: block.text,
          indent: block.indent
        }),
        saveLocalPageSnapshot: vi.fn(),
        shadowWriter,
        serializePageToMarkdown: () => "content",
        stampNow: () => "now"
      });
    });

    if (!autosaveApi) throw new Error("Autosave not initialized");

    return { autosaveApi, invoke, shadowWriter };
  };

  it("schedules a save and marks saved after persistence", async () => {
    const { autosaveApi, invoke, shadowWriter } = setup();

    autosaveApi.scheduleSave();

    expect(autosaveApi.autosaved()).toBe(false);

    await vi.runAllTimersAsync();

    expect(invoke).toHaveBeenCalledWith(
      "save_page_blocks",
      expect.objectContaining({
        pageUid: "page-1",
        page_uid: "page-1"
      })
    );
    expect(shadowWriter.scheduleWrite).toHaveBeenCalledWith(
      "page-1",
      "content"
    );
    expect(autosaveApi.autosaveError()).toBeNull();
    expect(autosaveApi.autosaveStamp()).toBe("now");
    expect(autosaveApi.autosaved()).toBe(true);
  });

  it("cancels a pending save", async () => {
    const { autosaveApi, invoke } = setup();

    autosaveApi.scheduleSave();
    autosaveApi.cancelPendingSave("page-1");

    await vi.runAllTimersAsync();

    expect(invoke).not.toHaveBeenCalled();
    expect(autosaveApi.autosaved()).toBe(false);
  });
});
