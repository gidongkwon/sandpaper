import { For, Show, type Accessor } from "solid-js";
import type { PageSummary } from "../../entities/page/model/page-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { IconButton } from "../../shared/ui/icon-button";
import { Add12Icon, Document16Icon } from "../../shared/ui/icons";

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
          <Add12Icon width="12" height="12" />
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
                <Document16Icon class="page-item__icon" width="14" height="14" />
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
