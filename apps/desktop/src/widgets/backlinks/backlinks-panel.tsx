import { For, Show, type Accessor, type Component } from "solid-js";
import type { Block } from "../../entities/block/model/block-types";
import type { BacklinkEntry } from "../../entities/page/model/backlink-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { IconButton } from "../../shared/ui/icon-button";
import { Dismiss12Icon, Link16Icon, Link20Icon } from "../../shared/ui/icons";

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
          <Link16Icon width="13" height="13" />
          Backlinks
        </div>
        <IconButton
          class="backlinks-panel__close"
          label="Close backlinks"
          onClick={() => props.onClose()}
        >
          <Dismiss12Icon width="12" height="12" />
        </IconButton>
      </div>
      <div class="backlinks-panel__body">
        <Show
          when={
            props.activePageBacklinks().length > 0 ||
            (props.activeBlock() && props.activeBacklinks().length > 0)
          }
          fallback={
            <EmptyState class="backlinks-panel__empty">
              <div class="backlinks-panel__empty-icon">
                <Link20Icon width="20" height="20" />
              </div>
              <p>No backlinks yet</p>
              <span>
                Use <code>((block-id))</code> or <code>[[Page]]</code> to create links
              </span>
            </EmptyState>
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
