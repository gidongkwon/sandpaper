import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { createSignal, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Block } from "../../entities/block/model/block-types";
import type { LocalPageRecord, PageSummary } from "../../entities/page/model/page-types";
import type { PageId } from "../../shared/model/id-types";
import type { PluginRenderer } from "../../entities/plugin/model/plugin-types";
import { EditorPane } from "./editor-pane";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

beforeEach(() => {
  window.localStorage.clear();
});

const makeBlocks = (total: number) =>
  Array.from({ length: total }, (_, index) => ({
    id: `b${index + 1}`,
    text: `Block ${index + 1}`,
    indent: 0
  }));

describe("EditorPane", () => {
  it("ignores plugin updates after the block unmounts", async () => {
    const baseBlocks = makeBlocks(40);
    baseBlocks[0] = {
      id: "plugin-1",
      text: "```hn-top count=5 :: Loading HN top",
      indent: 0
    };
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);

    let resolveInvoke: ((value: unknown) => void) | undefined;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );

    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const renderer: PluginRenderer = {
      plugin_id: "hn-top",
      id: "hn-top.block",
      title: "Hacker News Top",
      kind: "block",
      languages: ["hn-top"]
    };
    const blockRenderers = new Map<string, PluginRenderer>([
      ["hn-top", renderer]
    ]);

    const scheduleSave = vi.fn();

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={scheduleSave}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => true}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => blockRenderers}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalled());

    const scrollHost = container.querySelector(
      ".editor-pane__body"
    ) as HTMLDivElement | null;
    expect(scrollHost).not.toBeNull();
    if (!scrollHost) return;

    scrollHost.scrollTop = 1000;
    scrollHost.dispatchEvent(new Event("scroll"));

    await Promise.resolve();

    resolveInvoke?.({
      plugin_id: "hn-top",
      renderer_id: "hn-top.block",
      block_uid: "plugin-1",
      cache: { ttlSeconds: 60 },
      body: { kind: "list", items: ["Story 1"] },
      next_text: "```hn-top count=5 :: Updated"
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(untrack(() => blocks[0].text)).toBe(
      "```hn-top count=5 :: Loading HN top"
    );
    expect(untrack(() => blocks[25].text)).toBe("Block 26");
    expect(scheduleSave).not.toHaveBeenCalled();
  });

  it("selects a range when dragging across blocks", async () => {
    const baseBlocks = makeBlocks(8);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const blockEls = Array.from(
      container.querySelectorAll<HTMLElement>(".block")
    );
    expect(blockEls.length).toBeGreaterThan(4);

    fireEvent.mouseDown(blockEls[1], { button: 0, clientY: 10 });
    fireEvent.mouseMove(blockEls[4], { clientY: 60 });

    const selectionBox = container.querySelector(".block-selection-box");
    expect(selectionBox).not.toBeNull();

    fireEvent.mouseUp(window);

    const selected = Array.from(
      container.querySelectorAll<HTMLElement>(".block.is-selected")
    );
    expect(selected.map((node) => node.dataset.blockId)).toEqual([
      "b2",
      "b3",
      "b4",
      "b5"
    ]);

    expect(container.querySelector(".block-selection-box")).toBeNull();
  });

  it("selects a shift-click range and clears with Escape", () => {
    const baseBlocks = makeBlocks(6);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const displays = Array.from(
      container.querySelectorAll<HTMLElement>(".block__display")
    );
    fireEvent.click(displays[1]);
    fireEvent.click(displays[4], { shiftKey: true });

    const selected = Array.from(
      container.querySelectorAll<HTMLElement>(".block.is-selected")
    );
    expect(selected.map((node) => node.dataset.blockId)).toEqual([
      "b2",
      "b3",
      "b4",
      "b5"
    ]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelectorAll(".block.is-selected")).toHaveLength(0);
  });

  it("runs bulk actions on the selected range", () => {
    const baseBlocks = makeBlocks(4);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");
    let nextId = 1;

    const { container, getByText } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: `new-${nextId++}`,
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const displays = Array.from(
      container.querySelectorAll<HTMLElement>(".block__display")
    );
    fireEvent.click(displays[1]);
    fireEvent.click(displays[2], { shiftKey: true });

    fireEvent.click(getByText("Indent"));
    expect(untrack(() => blocks[1].indent)).toBe(1);
    expect(untrack(() => blocks[2].indent)).toBe(1);

    fireEvent.click(getByText("Outdent"));
    expect(untrack(() => blocks[1].indent)).toBe(0);
    expect(untrack(() => blocks[2].indent)).toBe(0);

    fireEvent.click(getByText("Duplicate"));
    expect(untrack(() => blocks.length)).toBe(6);

    fireEvent.click(getByText("Delete"));
    expect(untrack(() => blocks.length)).toBe(4);
  });

  it("supports keyboard shortcuts for selection", () => {
    const baseBlocks = makeBlocks(4);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const displays = Array.from(
      container.querySelectorAll<HTMLElement>(".block__display")
    );
    fireEvent.click(displays[1]);
    fireEvent.click(displays[2], { shiftKey: true });

    fireEvent.keyDown(window, { key: "Tab" });
    expect(untrack(() => blocks[1].indent)).toBe(1);
    expect(untrack(() => blocks[2].indent)).toBe(1);

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(untrack(() => blocks[1].indent)).toBe(0);
    expect(untrack(() => blocks[2].indent)).toBe(0);

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(untrack(() => blocks.length)).toBe(6);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(untrack(() => blocks.length)).toBe(4);
  });

  it("moves selected blocks with Alt+ArrowDown", () => {
    const baseBlocks = makeBlocks(5);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const displays = Array.from(
      container.querySelectorAll<HTMLElement>(".block__display")
    );
    fireEvent.click(displays[1]);
    fireEvent.click(displays[2], { shiftKey: true });

    fireEvent.keyDown(window, { key: "ArrowDown", altKey: true, metaKey: true });
    expect(untrack(() => blocks.map((block) => block.id))).toEqual([
      "b1",
      "b4",
      "b2",
      "b3",
      "b5"
    ]);
  });

  it("moves the active block with Alt+ArrowUp", () => {
    const baseBlocks = makeBlocks(3);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const textarea = container.querySelector<HTMLTextAreaElement>(
      "textarea[data-block-id=\"b2\"]"
    );
    expect(textarea).not.toBeNull();
    if (!textarea) return;

    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: "ArrowUp", altKey: true, metaKey: true });

    expect(untrack(() => blocks.map((block) => block.id))).toEqual([
      "b2",
      "b1",
      "b3"
    ]);
  });

  it("reorders blocks with the drag handle", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "One", indent: 0 },
      { id: "b2", text: "Two", indent: 0 },
      { id: "b3", text: "Three", indent: 0 }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const dragHandle = container.querySelector<HTMLElement>(
      '[data-block-id="b3"] .block__drag-handle'
    );
    const targetBlock = container.querySelector<HTMLElement>('[data-block-id="b1"]');
    expect(dragHandle).not.toBeNull();
    expect(targetBlock).not.toBeNull();
    if (!dragHandle || !targetBlock) return;

    fireEvent.dragStart(dragHandle);
    fireEvent.dragOver(targetBlock, { clientY: 0 });
    fireEvent.drop(targetBlock, { clientY: 0 });
    fireEvent.dragEnd(dragHandle);

    expect(untrack(() => blocks.map((block) => block.id))).toEqual([
      "b3",
      "b1",
      "b2",
    ]);
  });

  it("reorders blocks with pointer-drag handle fallback", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "One", indent: 0 },
      { id: "b2", text: "Two", indent: 0 },
      { id: "b3", text: "Three", indent: 0 }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const dragHandle = container.querySelector<HTMLElement>(
      '[data-block-id="b1"] .block__drag-handle'
    );
    const targetBlock = container.querySelector<HTMLElement>('[data-block-id="b3"]');
    expect(dragHandle).not.toBeNull();
    expect(targetBlock).not.toBeNull();
    if (!dragHandle || !targetBlock) return;

    const elementFromPointMock = vi.fn(() => targetBlock);
    const originalElementFromPoint = (document as Document & {
      elementFromPoint?: (x: number, y: number) => Element | null;
    }).elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPointMock
    });

    fireEvent.pointerDown(dragHandle, {
      button: 0,
      pointerId: 7,
      clientX: 8,
      clientY: 8
    });
    fireEvent.pointerMove(window, {
      pointerId: 7,
      clientX: 8,
      clientY: 8
    });
    fireEvent.pointerUp(window, {
      pointerId: 7,
      clientX: 8,
      clientY: 8
    });

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint
    });

    expect(untrack(() => blocks.map((block) => block.id))).toEqual([
      "b2",
      "b3",
      "b1"
    ]);
  });

  it("drops a block into a multi-column row target", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "out", text: "Outside", indent: 0, block_type: "text" },
      { id: "layout", text: "", indent: 0, block_type: "column_layout" },
      { id: "col-1", text: "", indent: 1, block_type: "column" },
      { id: "row-1", text: "Row inside", indent: 2, block_type: "text" },
      { id: "tail", text: "Tail", indent: 0, block_type: "text" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const dragHandle = container.querySelector<HTMLElement>(
      '[data-block-id="out"] .block__drag-handle'
    );
    const rowTarget = container.querySelector<HTMLElement>(
      '[data-block-id="layout"] .column-layout-preview__row'
    );
    expect(dragHandle).not.toBeNull();
    expect(rowTarget).not.toBeNull();
    if (!dragHandle || !rowTarget) return;

    fireEvent.dragStart(dragHandle);
    fireEvent.dragOver(rowTarget, { clientY: 0 });
    fireEvent.drop(rowTarget, { clientY: 0 });
    fireEvent.dragEnd(dragHandle);

    const next = untrack(() => blocks);
    const movedIndex = next.findIndex((block) => block.id === "out");
    const rowIndex = next.findIndex((block) => block.id === "row-1");
    expect(movedIndex).toBeGreaterThanOrEqual(0);
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    expect(movedIndex).toBeLessThan(rowIndex);
    expect(next[movedIndex]?.indent).toBe(2);
  });

  it("allows Shift+Enter to avoid creating a new block", () => {
    const baseBlocks = makeBlocks(2);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const textarea = container.querySelector<HTMLTextAreaElement>(
      "textarea[data-block-id=\"b1\"]"
    );
    expect(textarea).not.toBeNull();
    if (!textarea) return;

    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(untrack(() => blocks.length)).toBe(2);
  });

  it("focuses the previous block when deleting an empty block with Backspace", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "First", indent: 0 },
      { id: "b2", text: "", indent: 0 },
      { id: "b3", text: "Third", indent: 0 }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const second = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="b2"]'
    );
    expect(second).not.toBeNull();
    if (!second) return;

    fireEvent.focus(second);
    fireEvent.keyDown(second, { key: "Backspace" });

    expect(untrack(() => blocks.map((block) => block.id))).toEqual(["b1", "b3"]);
    expect(untrack(focusedId)).toBe("b1");
    expect(untrack(activeId)).toBe("b1");
  });

  it("does not clear focusedId when an old block blur fires after focus moved", () => {
    const baseBlocks = makeBlocks(2);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const first = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="b1"]'
    );
    const second = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="b2"]'
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;

    fireEvent.focus(first);
    expect(untrack(focusedId)).toBe("b1");

    fireEvent.focus(second);
    expect(untrack(focusedId)).toBe("b2");

    // Simulate blur event ordering where the old input blurs after focus already moved.
    fireEvent.blur(first);
    expect(untrack(focusedId)).toBe("b2");
  });

  it("keeps the same textarea node while typing in a focused block", () => {
    const baseBlocks = makeBlocks(2);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const first = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="b1"]'
    );
    expect(first).not.toBeNull();
    if (!first) return;

    fireEvent.focus(first);
    fireEvent.input(first, { target: { value: "Block 1 edited" } });

    const next = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="b1"]'
    );
    expect(next).toBe(first);
  });

  it("auto-resizes a focused textarea while typing multiline content", () => {
    const baseBlocks = makeBlocks(2);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const first = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="b1"]'
    );
    expect(first).not.toBeNull();
    if (!first) return;

    fireEvent.focus(first);
    Object.defineProperty(first, "scrollHeight", {
      configurable: true,
      value: 72
    });
    fireEvent.input(first, { target: { value: "Line 1\nLine 2\nLine 3" } });

    expect(first.style.height).toBe("72px");
  });

  it("shows full source syntax when editing code blocks, but keeps text lists unchanged", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "code-1", text: "console.log('hello')", indent: 0, block_type: "code" },
      { id: "list-1", text: "- one\n- two", indent: 0, block_type: "text" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const codeInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="code-1"]'
    );
    expect(codeInput).not.toBeNull();
    if (!codeInput) return;
    fireEvent.focus(codeInput);
    expect(codeInput.value.startsWith("```")).toBe(true);

    const listInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="list-1"]'
    );
    expect(listInput).not.toBeNull();
    if (!listInput) return;
    fireEvent.focus(listInput);
    expect(listInput.value).toBe("- one\n- two");
  });

  it("updates block type while typing markdown prefixes", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "typed-1", text: "```text console.log('hello')", indent: 0, block_type: "code" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="typed-1"]'
    );
    expect(input).not.toBeNull();
    if (!input) return;
    fireEvent.focus(input);

    fireEvent.input(input, { target: { value: "# Heading" } });
    expect(untrack(() => blocks[0].block_type)).toBe("heading1");

    fireEvent.input(input, { target: { value: "> Quoted" } });
    expect(untrack(() => blocks[0].block_type)).toBe("quote");

    fireEvent.input(input, { target: { value: "- [ ] Task" } });
    expect(untrack(() => blocks[0].block_type)).toBe("todo");

    fireEvent.input(input, { target: { value: "Just text" } });
    expect(untrack(() => blocks[0].block_type)).toBe("text");
  });

  it("does not render the block hover actions menu", () => {
    const baseBlocks = makeBlocks(2);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");
    let nextId = 1;

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: `new-${nextId++}`,
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const actions = container.querySelector(".block__actions");
    expect(actions).toBeNull();
    expect(
      container.querySelector('[aria-label="Insert block below"]')
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Duplicate block"]')
    ).toBeNull();
  });

  it("opens a context menu for selected blocks", () => {
    const baseBlocks = makeBlocks(4);
    const [blocks, setBlocks] = createStore<Block[]>(baseBlocks);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const displays = Array.from(
      container.querySelectorAll<HTMLElement>(".block__display")
    );
    fireEvent.click(displays[1]);
    fireEvent.click(displays[2], { shiftKey: true });
    fireEvent.contextMenu(displays[1], { clientX: 80, clientY: 120 });

    const menu = container.querySelector<HTMLElement>(".block-selection-menu");
    expect(menu).not.toBeNull();
    if (!menu) return;

    const menuApi = within(menu);
    fireEvent.click(menuApi.getByRole("button", { name: "Delete" }));
    expect(untrack(() => blocks.length)).toBe(2);
    expect(container.querySelector(".block-selection-menu")).toBeNull();
  });

  it("toggles block folding and hides descendants", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "Parent", indent: 0 },
      { id: "b2", text: "Child", indent: 1 },
      { id: "b3", text: "Grandchild", indent: 2 },
      { id: "b4", text: "Sibling", indent: 0 }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    let parent = container.querySelector<HTMLElement>('[data-block-id="b1"]');
    expect(parent).not.toBeNull();
    if (!parent) return;

    const parentToggle = within(parent).getByRole("button", {
      name: "Collapse block"
    });
    fireEvent.click(parentToggle);

    expect(container.querySelector('[data-block-id="b2"]')).toBeNull();
    expect(container.querySelector('[data-block-id="b3"]')).toBeNull();
    expect(container.querySelector('[data-block-id="b4"]')).not.toBeNull();

    parent = container.querySelector<HTMLElement>('[data-block-id="b1"]');
    expect(parent).not.toBeNull();
    if (!parent) return;

    const expandToggle = within(parent).getByRole("button", {
      name: "Expand block"
    });
    fireEvent.click(expandToggle);

    expect(container.querySelector('[data-block-id="b2"]')).not.toBeNull();
    expect(container.querySelector('[data-block-id="b3"]')).not.toBeNull();
  });

  it("folds to a level from the outline menu", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "Parent", indent: 0 },
      { id: "b2", text: "Child", indent: 1 },
      { id: "b3", text: "Grandchild", indent: 2 },
      { id: "b4", text: "Sibling", indent: 0 }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const outlineButton = within(container).getByRole("button", {
      name: "Outline"
    });
    fireEvent.click(outlineButton);

    const menu = container.querySelector<HTMLElement>(".editor-outline-menu");
    expect(menu).not.toBeNull();
    if (!menu) return;

    fireEvent.click(
      within(menu).getByRole("button", { name: "Fold to level 1" })
    );
    expect(container.querySelector('[data-block-id="b3"]')).toBeNull();
    expect(container.querySelector('[data-block-id="b2"]')).not.toBeNull();

    fireEvent.click(outlineButton);
    const menuAgain = container.querySelector<HTMLElement>(".editor-outline-menu");
    expect(menuAgain).not.toBeNull();
    if (!menuAgain) return;

    fireEvent.click(within(menuAgain).getByRole("button", { name: "Unfold all" }));
    expect(container.querySelector('[data-block-id="b3"]')).not.toBeNull();
  });

  it("shows breadcrumbs for the focused block", async () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "Parent", indent: 0 },
      { id: "b2", text: "Child", indent: 1 },
      { id: "b3", text: "Grandchild", indent: 2 },
      { id: "b4", text: "Sibling", indent: 0 }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const targetDisplay = container.querySelector<HTMLElement>(
      '[data-block-id="b3"] .block__display'
    );
    expect(targetDisplay).not.toBeNull();
    if (!targetDisplay) return;

    fireEvent.click(targetDisplay);

    await waitFor(() => {
      const breadcrumb = container.querySelector(".editor-pane__breadcrumb");
      expect(breadcrumb).not.toBeNull();
      expect(breadcrumb?.textContent).toContain("Parent");
      expect(breadcrumb?.textContent).toContain("Child");
      expect(breadcrumb?.textContent).toContain("Grandchild");
    });
  });

  it("renders todo text without markdown checkbox marker in display mode", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "b1", text: "- [ ] Buy milk", indent: 0, block_type: "todo" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const display = container.querySelector<HTMLElement>(
      '[data-block-id="b1"] .block__display'
    );
    expect(display).not.toBeNull();
    expect(display?.textContent).toContain("Buy milk");
    expect(display?.textContent).not.toContain("- [ ]");

    const todoCheckbox = container.querySelector(
      '[data-block-id="b1"] .block__todo-check'
    );
    expect(todoCheckbox).not.toBeNull();
  });

  it("hides type marker prefixes in display mode", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "h1", text: "# Heading title", indent: 0, block_type: "heading1" },
      { id: "q1", text: "> Quoted text", indent: 0, block_type: "quote" },
      { id: "c1", text: "```ts\nconst answer = 42\n```", indent: 0, block_type: "code" },
      { id: "l1", text: "- Keep list marker", indent: 0, block_type: "text" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const headingDisplay = container.querySelector<HTMLElement>(
      '[data-block-id="h1"] .block__display'
    );
    expect(headingDisplay?.textContent).toContain("Heading title");
    expect(headingDisplay?.textContent).not.toContain("# ");

    const quoteDisplay = container.querySelector<HTMLElement>(
      '[data-block-id="q1"] .block__display'
    );
    expect(quoteDisplay?.textContent).toContain("Quoted text");
    expect(quoteDisplay?.textContent).not.toContain("> ");

    const codeDisplay = container.querySelector<HTMLElement>(
      '[data-block-id="c1"] .block__display'
    );
    expect(codeDisplay?.textContent).toContain("const answer = 42");
    expect(codeDisplay?.textContent).not.toContain("```");

    const listDisplay = container.querySelector<HTMLElement>(
      '[data-block-id="l1"] .block__display'
    );
    expect(listDisplay?.textContent).toContain("- Keep list marker");
  });

  it("renders ordered list, bookmark, file, math, and toc block previews", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "h1", text: "# Intro", indent: 0, block_type: "heading1" },
      { id: "toc1", text: "[TOC]", indent: 0, block_type: "toc" },
      { id: "o1", text: "1. First item", indent: 0, block_type: "ordered_list" },
      { id: "b1", text: "https://example.com/article", indent: 0, block_type: "bookmark" },
      { id: "f1", text: "[Spec](/assets/spec--abc123.pdf)", indent: 0, block_type: "file" },
      { id: "m1", text: "$$ E = mc^2 $$", indent: 0, block_type: "math" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const ordered = container.querySelector<HTMLElement>(
      '[data-block-id="o1"] .block__ordered-index'
    );
    expect(ordered).not.toBeNull();
    expect(ordered?.textContent?.trim()).toBe("1.");

    const bookmark = container.querySelector<HTMLElement>(
      '[data-block-id="b1"] .block-renderer--bookmark'
    );
    expect(bookmark).not.toBeNull();
    expect(bookmark?.textContent).toContain("example.com");

    const file = container.querySelector<HTMLElement>(
      '[data-block-id="f1"] .block-renderer--file'
    );
    expect(file).not.toBeNull();
    expect(file?.textContent).toContain("Spec");

    const math = container.querySelector<HTMLElement>(
      '[data-block-id="m1"] .block-renderer--math'
    );
    expect(math).not.toBeNull();
    expect(math?.textContent).toContain("E = mc^2");
    expect(math?.textContent).not.toContain("$$");

    const toc = container.querySelector<HTMLElement>(
      '[data-block-id="toc1"] .block-renderer--toc'
    );
    expect(toc).not.toBeNull();
    expect(toc?.textContent).toContain("Intro");
  });

  it("renders markdown tables in display mode and preserves full source while editing", async () => {
    const tableSource = "| Name | Qty |\n| --- | --- |\n| Pencil | 2 |";
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "tb1", text: tableSource, indent: 0, block_type: "table" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const table = container.querySelector<HTMLElement>(
      '[data-block-id="tb1"] .markdown-table'
    );
    expect(table).not.toBeNull();
    expect(table?.textContent).toContain("Name");
    expect(table?.textContent).toContain("Pencil");
    expect(table?.textContent).not.toContain("| --- | --- |");

    const display = container.querySelector<HTMLElement>(
      '[data-block-id="tb1"] .block__display'
    );
    expect(display).not.toBeNull();
    if (!display) return;
    fireEvent.click(display);

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="tb1"]'
    );
    expect(input).not.toBeNull();
    if (!input) return;
    await waitFor(() => {
      expect(input.style.display).toBe("block");
      expect(input.value).toBe(tableSource);
    });
  });

  it("filters database view results using database language block query", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "db1", text: "```database project", indent: 0, block_type: "database_view" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");
    const projectUid = "project-alpha" as PageId;
    const inboxUid = "inbox" as PageId;
    const randomUid = "random" as PageId;
    const pageList: PageSummary[] = [
      { uid: projectUid, title: "Project Alpha" },
      { uid: inboxUid, title: "Inbox" },
      { uid: randomUid, title: "Random" }
    ];
    const cachedPages: Record<PageId, LocalPageRecord> = {
      [projectUid]: {
        uid: projectUid,
        title: "Project Alpha",
        blocks: [{ id: "p1", text: "overview", indent: 0, block_type: "text" }]
      },
      [inboxUid]: {
        uid: inboxUid,
        title: "Inbox",
        blocks: [{ id: "i1", text: "project notes", indent: 0, block_type: "text" }]
      },
      [randomUid]: {
        uid: randomUid,
        title: "Random",
        blocks: [{ id: "r1", text: "misc", indent: 0, block_type: "text" }]
      }
    };

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => pageList}
        activePageUid={() => projectUid}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={cachedPages}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const preview = container.querySelector<HTMLElement>(
      '[data-block-id="db1"] .block-renderer--database'
    );
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("Query: project");
    expect(preview?.textContent).toContain("Project Alpha");
    expect(preview?.textContent).toContain("Inbox");
    expect(preview?.textContent).not.toContain("Random");
  });

  it("renders column layout preview without title, count, or column names", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "layout", text: "", indent: 0, block_type: "column_layout" },
      { id: "col-1", text: "Column 1", indent: 1, block_type: "column" },
      { id: "row-1", text: "Task row", indent: 2, block_type: "text" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const preview = container.querySelector<HTMLElement>(
      '[data-block-id="layout"] .column-layout-preview'
    );
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("Task row");
    expect(preview?.textContent).not.toContain("Column 1");

    const display = container.querySelector<HTMLElement>(
      '[data-block-id="layout"] .block__display'
    );
    expect(display?.textContent).not.toContain("Column layout");
    expect(display?.textContent).not.toContain("1 column");
  });

  it("renders column child blocks as real editable blocks with drag handles", async () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "layout", text: "", indent: 0, block_type: "column_layout" },
      { id: "col-1", text: "", indent: 1, block_type: "column" },
      { id: "row-1", text: "Task row", indent: 2, block_type: "text" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const rowBlock = container.querySelector<HTMLElement>(
      '[data-block-id="layout"] .column-layout-preview [data-block-id="row-1"]'
    );
    expect(rowBlock).not.toBeNull();
    expect(rowBlock).toHaveClass("block");
    expect(
      rowBlock?.querySelector('[aria-label="Drag block"].block__drag-handle')
    ).not.toBeNull();

    const layoutInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="layout"]'
    );
    expect(layoutInput).not.toBeNull();
    if (!layoutInput) return;
    fireEvent.keyDown(layoutInput, { key: "Escape" });
    await waitFor(() => {
      expect(layoutInput.style.display).toBe("none");
    });

    const rowDisplay = rowBlock?.querySelector<HTMLElement>(".block__display");
    expect(rowDisplay).not.toBeNull();
    if (!rowDisplay) return;
    fireEvent.click(rowDisplay);

    const rowInput = rowBlock?.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="row-1"]'
    );
    expect(rowInput).not.toBeNull();
    if (!rowInput) return;
    await waitFor(() => {
      expect(rowInput.style.display).toBe("block");
      expect(rowInput.getAttribute("aria-hidden")).toBe("false");
      expect(layoutInput.style.display).toBe("none");
    });

    fireEvent.input(rowInput, { target: { value: "Task row updated" } });
    expect(untrack(() => blocks.find((block) => block.id === "row-1")?.text)).toBe(
      "Task row updated"
    );
  });

  it("keeps focus on the same column child textarea while typing", async () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "layout", text: "", indent: 0, block_type: "column_layout" },
      { id: "col-1", text: "", indent: 1, block_type: "column" },
      { id: "row-1", text: "Task row", indent: 2, block_type: "text" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0) => ({
          id: "new",
          text,
          indent
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const layoutInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="layout"]'
    );
    expect(layoutInput).not.toBeNull();
    if (!layoutInput) return;
    fireEvent.keyDown(layoutInput, { key: "Escape" });
    await waitFor(() => {
      expect(layoutInput.style.display).toBe("none");
    });

    const rowBlock = container.querySelector<HTMLElement>(
      '[data-block-id="layout"] .column-layout-preview [data-block-id="row-1"]'
    );
    expect(rowBlock).not.toBeNull();
    if (!rowBlock) return;

    const rowDisplay = rowBlock.querySelector<HTMLElement>(".block__display");
    expect(rowDisplay).not.toBeNull();
    if (!rowDisplay) return;
    fireEvent.click(rowDisplay);

    const firstInput = rowBlock.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="row-1"]'
    );
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    await waitFor(() => {
      expect(firstInput.style.display).toBe("block");
      expect(firstInput.getAttribute("aria-hidden")).toBe("false");
      expect(document.activeElement).toBe(firstInput);
    });

    fireEvent.input(firstInput, { target: { value: "Task row updated once" } });

    const nextInput = rowBlock.querySelector<HTMLTextAreaElement>(
      'textarea[data-block-id="row-1"]'
    );
    expect(nextInput).toBe(firstInput);
    expect(document.activeElement).toBe(nextInput);
  });

  it("stores new columns without a generated name", () => {
    const [blocks, setBlocks] = createStore<Block[]>([
      { id: "layout", text: "", indent: 0, block_type: "column_layout" }
    ]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [focusedId, setFocusedId] = createSignal<string | null>(null);
    type EditorPaneProps = Parameters<typeof EditorPane>[0];
    const jumpTarget = (() => null) as EditorPaneProps["jumpTarget"];
    const setJumpTarget = vi.fn() as EditorPaneProps["setJumpTarget"];
    const [renameTitle, setRenameTitle] = createSignal("");
    const [pageTitle] = createSignal("Test Page");

    const { container } = render(() => (
      <EditorPane
        blocks={blocks}
        setBlocks={setBlocks}
        activeId={activeId}
        setActiveId={setActiveId}
        focusedId={focusedId}
        setFocusedId={setFocusedId}
        highlightedBlockId={() => null}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        createNewBlock={(text = "", indent = 0, block_type) => ({
          id: `${block_type ?? "text"}-${Math.random().toString(16).slice(2, 10)}`,
          text,
          indent,
          block_type
        })}
        scheduleSave={vi.fn()}
        recordLatency={vi.fn()}
        addReviewItem={vi.fn()}
        pageBusy={() => false}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renamePage={vi.fn()}
        pages={() => [] as PageSummary[]}
        activePageUid={() => "page-1" as PageId}
        resolvePageUid={(value) => value as PageId}
        setNewPageTitle={vi.fn()}
        createPage={vi.fn()}
        switchPage={vi.fn()}
        createPageFromLink={vi.fn()}
        isTauri={() => false}
        localPages={{} as Record<PageId, LocalPageRecord>}
        saveLocalPageSnapshot={vi.fn()}
        snapshotBlocks={(source) => source.map((block) => ({ ...block }))}
        pageTitle={pageTitle}
        renderersByKind={() => new Map()}
        blockRenderersByLang={() => new Map()}
        perfEnabled={() => false}
        scrollMeter={{ notifyScroll: vi.fn() }}
      />
    ));

    const addColumnButton = within(container).getByRole("button", {
      name: "Add column"
    });
    fireEvent.click(addColumnButton);

    const nextBlocks = untrack(() => blocks);
    const createdColumn = nextBlocks.find(
      (block, index) => index > 0 && block.block_type === "column"
    );
    expect(createdColumn).toBeDefined();
    expect(createdColumn?.text).toBe("");
  });
});
