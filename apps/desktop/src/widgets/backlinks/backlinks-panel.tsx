import { For, Show, type Accessor, type Component } from "solid-js";
import type { Block } from "../../entities/block/model/block-types";
import type { BacklinkEntry } from "../../entities/page/model/backlink-types";

type BacklinksPanelProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  sectionJump: Component<{ id: string; label: string }>;
  activePageBacklinks: Accessor<BacklinkEntry[]>;
  activeBacklinks: Accessor<BacklinkEntry[]>;
  activeBlock: Accessor<Block | null>;
  pageTitle: Accessor<string>;
  groupedPageBacklinks: Accessor<Array<{ title: string; entries: BacklinkEntry[] }>>;
  supportsMultiPane: boolean;
  openPageBacklinkInPane: (entry: BacklinkEntry) => void | Promise<void>;
  openPageBacklink: (entry: BacklinkEntry) => void | Promise<void>;
  formatBacklinkSnippet: (text: string) => string;
  onBlockBacklinkSelect: (entry: BacklinkEntry) => void;
};

export const BacklinksPanel = (props: BacklinksPanelProps) => {
  return (
    <aside class={`backlinks-panel ${props.open() ? "is-open" : ""}`}>
      <Show when={props.open()}>
        <props.sectionJump id="backlinks" label="Backlinks" />
      </Show>
      <div class="backlinks-panel__header">
        <div class="backlinks-panel__title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          Backlinks
        </div>
        <button
          class="backlinks-panel__close"
          onClick={() => props.onClose()}
          aria-label="Close backlinks"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="backlinks-panel__body">
        <Show
          when={
            props.activePageBacklinks().length > 0 ||
            (props.activeBlock() && props.activeBacklinks().length > 0)
          }
          fallback={
            <div class="backlinks-panel__empty">
              <div class="backlinks-panel__empty-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <p>No backlinks yet</p>
              <span>
                Use <code>((block-id))</code> or <code>[[Page]]</code> to create links
              </span>
            </div>
          }
        >
          <Show when={props.activePageBacklinks().length > 0}>
            <div class="backlinks-panel__section">
              <div class="backlinks-panel__section-title">Page backlinks</div>
              <div class="backlinks-panel__context">
                Linked to page <strong>{props.pageTitle()}</strong>
              </div>
              <div class="backlinks-panel__groups">
                <For each={props.groupedPageBacklinks()}>
                  {(group) => (
                    <div class="backlink-group">
                      <div class="backlink-group__header">
                        <div class="backlink-group__title">{group.title}</div>
                        <Show when={props.supportsMultiPane}>
                          <button
                            class="backlink-group__action"
                            type="button"
                            onClick={() =>
                              void props.openPageBacklinkInPane(group.entries[0])
                            }
                          >
                            Open in pane
                          </button>
                        </Show>
                      </div>
                      <div class="backlink-group__list">
                        <For each={group.entries}>
                          {(entry) => (
                            <button
                              class="backlink-item"
                              onClick={() => void props.openPageBacklink(entry)}
                            >
                              <div class="backlink-item__text">
                                {props.formatBacklinkSnippet(entry.text || "Untitled")}
                              </div>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={props.activeBlock()}>
            {(block) => (
              <Show when={props.activeBacklinks().length > 0}>
                <div class="backlinks-panel__section">
                  <div class="backlinks-panel__section-title">Block backlinks</div>
                  <div class="backlinks-panel__context">
                    Linked to <strong>{block().text.slice(0, 40) || "this block"}{block().text.length > 40 ? "..." : ""}</strong>
                  </div>
                  <div class="backlinks-panel__list">
                    <For each={props.activeBacklinks()}>
                      {(entry) => (
                        <button
                          class="backlink-item"
                          onClick={() => props.onBlockBacklinkSelect(entry)}
                        >
                          <div class="backlink-item__text">
                            {props.formatBacklinkSnippet(entry.text || "Untitled")}
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </aside>
  );
};
