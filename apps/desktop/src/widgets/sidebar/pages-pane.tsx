import { Show, createMemo, type Accessor } from "solid-js";
import type { PageSummary } from "../../entities/page/model/page-types";
import { EmptyState } from "../../shared/ui/empty-state";
import { ActionListbox, type ActionListboxOption } from "../../shared/ui/action-listbox";
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
  const pageOptions = createMemo<ActionListboxOption<PageSummary>[]>(() =>
    props.pages().map((page) => ({
      value: page.uid,
      label: page.title || "Untitled",
      data: page
    }))
  );
  const activePageUid = createMemo(() => props.resolvePageUid(props.activePageUid()));

  return (
    <div class="sidebar__section">
      <div class="sidebar__section-header">
        <span class="sidebar__section-title">Pages</span>
        <IconButton
          variant="sidebar"
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
      <ActionListbox
        options={pageOptions()}
        selectedValue={activePageUid()}
        onSelect={(option) => void props.onSwitch(option.data.uid)}
        ariaLabel="Pages"
        variant="page-nav"
        class="page-list"
        itemClass="page-item"
        itemLabelClass="page-item__label"
        renderLabel={(option) => (
          <>
            <Document16Icon class="page-item__icon" width="14" height="14" />
            <div class="page-item__content">
              <div class="page-item__title">{option.data.title || "Untitled"}</div>
            </div>
          </>
        )}
        emptyState={<EmptyState class="page-list__empty" message="No pages yet" />}
      />
    </div>
  );
};
