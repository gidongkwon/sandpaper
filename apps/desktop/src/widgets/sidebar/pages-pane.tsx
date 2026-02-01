import { For, Show, type Accessor } from "solid-js";
import type { PageSummary } from "../../entities/page/model/page-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { IconButton } from "../../shared/ui/icon-button";

type PagesPaneProps = {
  pages: Accessor<PageSummary[]>;
  activePageUid: Accessor<string>;
  resolvePageUid: (value: string) => string;
  onSwitch: (uid: string) => void | Promise<void>;
  pageMessage: Accessor<string | null>;
  onCreate: () => void;
};

export const PagesPane = (props: PagesPaneProps) => {
  return (
    <div class="sidebar__section">
      <div class="sidebar__section-header">
        <span class="sidebar__section-title">Pages</span>
        <IconButton
          class="sidebar__section-action"
          label="Create new page"
          onClick={props.onCreate}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </IconButton>
      </div>
      <Show when={props.pageMessage()}>
        {(message) => <div class="page-message">{message()}</div>}
      </Show>
      <div class="page-list">
        <Show
          when={props.pages().length > 0}
          fallback={<EmptyState class="page-list__empty" message="No pages yet" />}
        >
          <For each={props.pages()}>
            {(page) => (
              <button
                class={`page-item ${
                  page.uid === props.resolvePageUid(props.activePageUid())
                    ? "is-active"
                    : ""
                }`}
                onClick={() => props.onSwitch(page.uid)}
                aria-label={`Open ${page.title || "Untitled"}`}
              >
                <svg class="page-item__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
                <div class="page-item__content">
                  <div class="page-item__title">{page.title || "Untitled"}</div>
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
