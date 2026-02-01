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

  it("inserts a block below from the block actions", () => {
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

    const firstBlock = container.querySelector<HTMLElement>(".block");
    expect(firstBlock).not.toBeNull();
    if (!firstBlock) return;

    const actions = firstBlock.querySelector<HTMLElement>(".block__actions");
    expect(actions).not.toBeNull();
    if (!actions) return;

    const insertButton = within(actions).getByRole("button", {
      name: "Insert block below"
    });
    fireEvent.click(insertButton);

    expect(untrack(() => blocks[1].id)).toBe("new-1");
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
});
