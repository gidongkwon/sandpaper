import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  createFpsMeter,
  createPerfTracker,
  type PerfStats
} from "./editor/perf";
import { getVirtualRange } from "./editor/virtual-list";
import "./app.css";

type Block = {
  id: string;
  text: string;
  indent: number;
};

type Mode = "quick-capture" | "editor" | "review";

let nextId = 1;
const ROW_HEIGHT = 44;
const OVERSCAN = 6;

const createBlock = (text = "", indent = 0): Block => ({
  id: `b${nextId++}`,
  text,
  indent
});

function App() {
  const fillerBlocks = Array.from({ length: 60 }, (_, index) =>
    createBlock(`Draft line ${index + 1}`, index % 3)
  );
  const [blocks, setBlocks] = createStore<Block[]>([
    createBlock("Sandpaper outline prototype"),
    createBlock("Enter to add a block", 1),
    createBlock("Tab to indent, Shift+Tab to outdent", 1),
    createBlock("Backspace on empty removes the block", 1),
    ...fillerBlocks
  ]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<Mode>("editor");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [captureText, setCaptureText] = createSignal("");
  const [perfEnabled, setPerfEnabled] = createSignal(false);
  const [perfStats, setPerfStats] = createSignal<PerfStats>({
    count: 0,
    last: null,
    p50: null,
    p95: null
  });
  const [scrollFps, setScrollFps] = createSignal(0);

  const perfTracker = createPerfTracker({
    maxSamples: 160,
    onSample: () => {
      if (perfEnabled()) {
        setPerfStats(perfTracker.getStats());
      }
    }
  });
  const scrollMeter = createFpsMeter({
    onUpdate: (fps) => {
      if (perfEnabled()) {
        setScrollFps(fps);
      }
    }
  });

  const searchResults = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    if (!query) return [];
    return blocks
      .filter((block) => block.text.toLowerCase().includes(query))
      .slice(0, 12);
  });

  onMount(() => {
    const perfFlag =
      new URLSearchParams(window.location.search).has("perf") ||
      localStorage.getItem("sandpaper:perf") === "1";
    setPerfEnabled(perfFlag);
    if (perfFlag) {
      setPerfStats(perfTracker.getStats());
    }

    onCleanup(() => {
      scrollMeter.dispose();
    });
  });

  const recordLatency = (label: string) => {
    if (!perfEnabled()) return;
    perfTracker.mark(label);
  };

  const addCapture = () => {
    const text = captureText().trim();
    if (!text) return;
    const block = createBlock(text, 0);
    setBlocks(
      produce((draft) => {
        draft.unshift(block);
      })
    );
    setCaptureText("");
    setMode("editor");
    setActiveId(block.id);
  };

  const EditorPane = (props: { title: string; meta: string }) => {
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);
    const inputRefs = new Map<string, HTMLTextAreaElement>();
    let editorRef: HTMLDivElement | undefined;

    const range = createMemo(() =>
      getVirtualRange({
        count: blocks.length,
        rowHeight: ROW_HEIGHT,
        overscan: OVERSCAN,
        scrollTop: scrollTop(),
        viewportHeight: viewportHeight()
      })
    );

    const visibleBlocks = createMemo(() =>
      blocks.slice(range().start, range().end)
    );

    onMount(() => {
      if (!editorRef) return;
      setViewportHeight(editorRef.clientHeight);
      setScrollTop(editorRef.scrollTop);
      if (!activeId() && blocks.length > 0) {
        setActiveId(blocks[0].id);
      }

      const handleScroll = () => {
        setScrollTop(editorRef?.scrollTop ?? 0);
        if (perfEnabled()) {
          scrollMeter.notifyScroll();
        }
      };
      editorRef.addEventListener("scroll", handleScroll);

      const resizeObserver = new ResizeObserver(() => {
        if (!editorRef) return;
        setViewportHeight(editorRef.clientHeight);
      });
      resizeObserver.observe(editorRef);

      onCleanup(() => {
        editorRef?.removeEventListener("scroll", handleScroll);
        resizeObserver.disconnect();
      });
    });

    const scrollToIndex = (index: number) => {
      if (!editorRef || viewportHeight() === 0) return;
      const top = index * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      const viewTop = editorRef.scrollTop;
      const viewBottom = viewTop + viewportHeight();
      if (top < viewTop) {
        editorRef.scrollTop = top;
      } else if (bottom > viewBottom) {
        editorRef.scrollTop = bottom - viewportHeight();
      }
    };

    const findIndexById = (id: string) =>
      blocks.findIndex((block) => block.id === id);

    const focusBlock = (id: string, caret: "start" | "end" = "end") => {
      const index = findIndexById(id);
      if (index >= 0) scrollToIndex(index);
      setActiveId(id);
      requestAnimationFrame(() => {
        const el = inputRefs.get(id);
        if (!el) return;
        el.focus();
        const pos = caret === "start" ? 0 : el.value.length;
        el.setSelectionRange(pos, pos);
      });
    };

    const insertBlockAfter = (index: number, indent: number) => {
      const block = createBlock("", indent);
      setBlocks(
        produce((draft) => {
          draft.splice(index + 1, 0, block);
        })
      );
      focusBlock(block.id, "start");
    };

    const removeBlockAt = (index: number) => {
      if (blocks.length === 1) return;
      const prev = blocks[index - 1];
      const next = blocks[index + 1];
      setBlocks(
        produce((draft) => {
          draft.splice(index, 1);
        })
      );
      const target = next ?? prev;
      if (target) focusBlock(target.id);
    };

    const moveFocus = (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction;
      const target = blocks[nextIndex];
      if (!target) return;
      focusBlock(target.id, direction === -1 ? "end" : "start");
    };

    const handleKeyDown = (block: Block, index: number, event: KeyboardEvent) => {
      const target = event.currentTarget as HTMLTextAreaElement;
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd =
        target.selectionStart === target.value.length &&
        target.selectionEnd === target.value.length;

      if (event.key === "Enter") {
        event.preventDefault();
        recordLatency("insert");
        insertBlockAfter(index, block.indent);
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        recordLatency("indent");
        const delta = event.shiftKey ? -1 : 1;
        const nextIndent = Math.max(0, block.indent + delta);
        setBlocks(index, "indent", nextIndent);
        return;
      }

      if (event.key === "Backspace" && block.text.length === 0) {
        event.preventDefault();
        recordLatency("delete");
        removeBlockAt(index);
        return;
      }

      if (event.key === "ArrowUp" && atStart) {
        event.preventDefault();
        moveFocus(index, -1);
        return;
      }

      if (event.key === "ArrowDown" && atEnd) {
        event.preventDefault();
        moveFocus(index, 1);
      }
    };

    return (
      <section class="editor-pane">
        <div class="editor-pane__header">
          <div>
            <div class="editor-pane__title">{props.title}</div>
            <div class="editor-pane__meta">{props.meta}</div>
          </div>
          <div class="editor-pane__count">{blocks.length} blocks</div>
        </div>
        <div class="editor-pane__body" ref={editorRef}>
          <div class="virtual-space" style={{ height: `${range().totalHeight}px` }}>
            <div
              class="virtual-list"
              style={{ transform: `translateY(${range().offset}px)` }}
            >
              <For each={visibleBlocks()}>
                {(block, index) => {
                  const blockIndex = () => range().start + index();
                  return (
                    <div
                      class={`block ${activeId() === block.id ? "is-active" : ""}`}
                      style={{
                        "margin-left": `${block.indent * 24}px`,
                        "--i": `${blockIndex()}`
                      }}
                    >
                      <span class="block__bullet" aria-hidden="true" />
                      <textarea
                        ref={(el) => inputRefs.set(block.id, el)}
                        class="block__input"
                        rows={1}
                        value={block.text}
                        placeholder="Write something..."
                        spellcheck={true}
                        onFocus={() => setActiveId(block.id)}
                        onInput={(event) => {
                          recordLatency("input");
                          setBlocks(blockIndex(), "text", event.currentTarget.value);
                        }}
                        onKeyDown={(event) => handleKeyDown(block, blockIndex(), event)}
                      />
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div class="app">
      {perfEnabled() && (
        <aside class="perf-hud">
          <div class="perf-hud__title">Perf</div>
          <div class="perf-hud__row">
            Input p50 <span>{perfStats().p50?.toFixed(1) ?? "--"}ms</span>
          </div>
          <div class="perf-hud__row">
            Input p95 <span>{perfStats().p95?.toFixed(1) ?? "--"}ms</span>
          </div>
          <div class="perf-hud__row">
            Scroll <span>{scrollFps()} fps</span>
          </div>
          <div class="perf-hud__row">
            Samples <span>{perfStats().count}</span>
          </div>
        </aside>
      )}

      <header class="topbar">
        <div class="topbar__left">
          <div class="topbar__title">Sandpaper</div>
          <div class="topbar__subtitle">Local-first outline lab</div>
          <div class="topbar__meta">
            Enter: new block · Tab: indent · Shift+Tab: outdent · Backspace: delete empty
          </div>
        </div>
        <nav class="mode-switch">
          <button
            class={`mode-switch__button ${mode() === "quick-capture" ? "is-active" : ""}`}
            onClick={() => setMode("quick-capture")}
          >
            Quick Capture
          </button>
          <button
            class={`mode-switch__button ${mode() === "editor" ? "is-active" : ""}`}
            onClick={() => setMode("editor")}
          >
            Editor
          </button>
          <button
            class={`mode-switch__button ${mode() === "review" ? "is-active" : ""}`}
            onClick={() => setMode("review")}
          >
            Review
          </button>
        </nav>
      </header>

      <Show
        when={mode() === "editor"}
        fallback={
          <section class="focus-panel">
            <Show
              when={mode() === "quick-capture"}
              fallback={
                <div class="review">
                  <h2>Review queue</h2>
                  <p>Skim yesterday’s highlights, reconnect threads, and plan next steps.</p>
                  <ul>
                    <For each={blocks.slice(0, 6)}>
                      {(block) => <li>{block.text || "Untitled"}</li>}
                    </For>
                  </ul>
                </div>
              }
            >
              <div class="capture">
                <h2>Quick capture</h2>
                <p>Drop a thought and send it straight to your inbox.</p>
                <textarea
                  class="capture__input"
                  rows={4}
                  placeholder="Capture a thought, link, or task..."
                  value={captureText()}
                  onInput={(event) => setCaptureText(event.currentTarget.value)}
                />
                <div class="capture__actions">
                  <button class="capture__button" onClick={addCapture}>
                    Add to Inbox
                  </button>
                  <span class="capture__hint">Shift+Enter for newline</span>
                </div>
              </div>
            </Show>
          </section>
        }
      >
        <div class="workspace">
          <aside class="sidebar">
            <div>
              <div class="sidebar__title">Search</div>
              <div class="sidebar__subtitle">Find blocks instantly</div>
            </div>
            <input
              class="sidebar__input"
              type="search"
              placeholder="Search notes, tags, or IDs"
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
            />
            <div class="sidebar__filters">
              <button class="chip">All</button>
              <button class="chip">Links</button>
              <button class="chip">Tasks</button>
              <button class="chip">Pinned</button>
            </div>
            <div class="sidebar__results">
              <Show
                when={searchResults().length > 0}
                fallback={<div class="sidebar__empty">No results yet.</div>}
              >
                <For each={searchResults()}>
                  {(block) => (
                    <button
                      class="result"
                      onClick={() => setActiveId(block.id)}
                    >
                      <div class="result__text">{block.text || "Untitled"}</div>
                      <div class="result__meta">Block {block.id}</div>
                    </button>
                  )}
                </For>
              </Show>
            </div>
            <div class="sidebar__footer">
              <div>Vault: Sandpaper</div>
              <div>{blocks.length} blocks indexed</div>
            </div>
          </aside>

          <div class="panes">
            <EditorPane title="Primary editor" meta="Inbox / Daily" />
            <EditorPane title="Connection pane" meta="Split view" />
          </div>
        </div>
      </Show>
    </div>
  );
}

export default App;
