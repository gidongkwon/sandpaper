import { createSignal, untrack, type Accessor } from "solid-js";
import type { Block, BlockPayload } from "../../../entities/block/model/block-types";

export type AutosaveDependencies = {
  isTauri: () => boolean;
  invoke: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
  resolvePageUid: (value: string) => string;
  activePageUid: Accessor<string>;
  getBlocks: () => Block[];
  pageTitle: Accessor<string>;
  snapshotBlocks: (items: Block[]) => Block[];
  toPayload: (block: Block) => BlockPayload;
  saveLocalPageSnapshot: (pageUid: string, title: string, items: Block[]) => void;
  shadowWriter: { scheduleWrite: (pageUid: string, content: string) => void };
  serializePageToMarkdown: (page: {
    id: string;
    title: string;
    blocks: Array<{ id: string; text: string; indent: number }>;
  }) => string;
  stampNow?: () => string;
  onPersistError?: (error: unknown) => void;
};

export const createAutosave = (deps: AutosaveDependencies) => {
  const [autosaved, setAutosaved] = createSignal(false);
  const [autosaveStamp, setAutosaveStamp] = createSignal("");
  const [autosaveError, setAutosaveError] = createSignal<string | null>(null);

  let saveTimeout: number | undefined;
  let saveRequestId = 0;
  let pendingSavePageUid: string | null = null;

  const stampNow =
    deps.stampNow ??
    (() =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date()));

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
    if (!deps.isTauri()) {
      deps.saveLocalPageSnapshot(pageUid, title, snapshot);
      return true;
    }
    try {
      await deps.invoke("save_page_blocks", {
        pageUid,
        page_uid: pageUid,
        blocks: payload
      });
      return true;
    } catch (error) {
      deps.onPersistError?.(error);
      return false;
    }
  };

  const scheduleShadowWrite = (pageUid = deps.activePageUid()) => {
    if (!deps.isTauri()) return;
    const resolvedUid = deps.resolvePageUid(pageUid);
    const snapshot = untrack(() =>
      deps.getBlocks().map((block) => ({
        id: block.id,
        text: block.text,
        indent: block.indent
      }))
    );
    const title = untrack(() => deps.pageTitle());
    const content = deps.serializePageToMarkdown({
      id: resolvedUid,
      title,
      blocks: snapshot
    });
    deps.shadowWriter.scheduleWrite(resolvedUid, content);
  };

  const scheduleSave = () => {
    const pageUid = deps.resolvePageUid(deps.activePageUid());
    pendingSavePageUid = pageUid;
    const snapshot = untrack(() => deps.snapshotBlocks(deps.getBlocks()));
    const payload = snapshot.map((block) => deps.toPayload(block));
    const title = untrack(() => deps.pageTitle());
    saveRequestId += 1;
    const requestId = saveRequestId;
    if (saveTimeout) {
      window.clearTimeout(saveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
      void (async () => {
        const success = await persistBlocks(pageUid, payload, title, snapshot);
        if (requestId !== saveRequestId) return;
        pendingSavePageUid = null;
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

  const cancelPendingSave = (pageUid: string) => {
    if (pendingSavePageUid !== pageUid) return;
    if (saveTimeout) {
      window.clearTimeout(saveTimeout);
      saveTimeout = undefined;
    }
    saveRequestId += 1;
    pendingSavePageUid = null;
  };

  return {
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
  };
};
