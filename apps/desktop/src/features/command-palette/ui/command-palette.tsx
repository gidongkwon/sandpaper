import { Show, createMemo, type Accessor, type Setter } from "solid-js";
import { EmptyState } from "../../../shared/ui/empty-state";
import { ActionListbox, type ActionListboxOption } from "../../../shared/ui/action-listbox";
import { SearchDialog } from "../../../shared/ui/search-dialog";
import type { CommandPaletteItem } from "../../../pages/main-page/model/command-palette-utils";

type CommandPaletteProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  query: Accessor<string>;
  setQuery: Setter<string>;
  inputRef: (el: HTMLInputElement) => void;
  items: Accessor<CommandPaletteItem[]>;
  activeIndex: Accessor<number>;
  setActiveIndex: Setter<number>;
  moveIndex: (delta: number) => void;
  onRun: (command?: CommandPaletteItem) => void | Promise<void>;
};

export const CommandPalette = (props: CommandPaletteProps) => {
  const itemOptions = createMemo<ActionListboxOption<CommandPaletteItem>[]>(() =>
    props.items().map((item) => ({
      value: item.id,
      label:
        item.kind === "note"
          ? `${item.title} ${item.snippet ?? ""}`.trim()
          : item.label,
      description:
        item.kind === "note"
          ? item.breadcrumb ?? null
          : item.kind === "command"
            ? item.hint ?? null
            : "Create a new page",
      data: item
    }))
  );
  const activeItemId = createMemo(
    () => props.items()[props.activeIndex()]?.id ?? null
  );

  return (
    <SearchDialog
      open={props.open}
      onClose={props.onClose}
      ariaLabel="Command palette"
      variant="command"
      query={props.query}
      setQuery={props.setQuery}
      inputRef={props.inputRef}
      inputPlaceholder="Search notes and commands..."
      listLabel="Command results"
      class="command-palette"
      onInputKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          props.moveIndex(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          props.moveIndex(-1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void props.onRun(props.items()[props.activeIndex()]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <Show
        when={props.items().length > 0}
        fallback={
          <EmptyState class="command-palette__empty" message="No matches" />
        }
      >
        <ActionListbox
          options={itemOptions()}
          selectedValue={activeItemId()}
          onSelect={(option) => void props.onRun(option.data)}
          ariaLabel="Command results"
          variant="command"
          itemLabelClass="command-palette__result"
          itemDescriptionClass="command-palette__meta"
          renderLabel={(option) => (
            <div class="command-palette__row">
              <div class="command-palette__content">
                <Show when={option.data.kind === "note"}>
                  <div class="command-palette__title">
                    {(option.data.kind === "note" && option.data.title) || option.label}
                  </div>
                </Show>
                <div class="command-palette__label">
                  {option.data.kind === "note"
                    ? option.data.snippet || "Open page"
                    : option.label}
                </div>
              </div>
              <div class="command-palette__badge">
                {option.data.kind === "note"
                  ? "Note"
                  : option.data.kind === "command"
                    ? "Command"
                    : "Create"}
              </div>
            </div>
          )}
          renderDescription={(option) => (
            <span>
              {option.data.kind === "note"
                ? option.data.breadcrumb || option.data.pageUid
                : option.data.kind === "command"
                  ? option.data.hint || null
                  : "Create a page with this title"}
            </span>
          )}
        />
      </Show>
    </SearchDialog>
  );
};
