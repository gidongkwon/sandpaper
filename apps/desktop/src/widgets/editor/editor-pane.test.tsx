import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { createSignal, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Block } from "../../entities/block/model/block-types";
import type { LocalPageRecord, PageSummary } from "../../entities/page/model/page-types";
import type { PageId } from "../../shared/model/id-types";
import type { PluginRenderer } from "../../entities/plugin/model/plugin-types";
import { EditorPane } from "./editor-pane";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

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
});
