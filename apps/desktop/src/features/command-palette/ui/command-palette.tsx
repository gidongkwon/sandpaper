import { Show, createMemo, type Accessor, type Setter } from "solid-js";
import { EmptyState } from "../../../shared/ui/empty-state";
import { ActionListbox, type ActionListboxOption } from "../../../shared/ui/action-listbox";
import { SearchDialog } from "../../../shared/ui/search-dialog";

type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  action: () => void | Promise<void>;
};

type CommandPaletteProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  query: Accessor<string>;
  setQuery: Setter<string>;
  inputRef: (el: HTMLInputElement) => void;
  commands: Accessor<CommandPaletteItem[]>;
  activeIndex: Accessor<number>;
  setActiveIndex: Setter<number>;
  moveIndex: (delta: number) => void;
  onRun: (command?: CommandPaletteItem) => void | Promise<void>;
};

export const CommandPalette = (props: CommandPaletteProps) => {
  const commandOptions = createMemo<ActionListboxOption<CommandPaletteItem>[]>(() =>
    props.commands().map((command) => ({
      value: command.id,
      label: command.label,
      description: command.hint,
      data: command
    }))
  );
  const activeCommandId = createMemo(
    () => props.commands()[props.activeIndex()]?.id ?? null
  );

  return (
    <SearchDialog
      open={props.open}
      onClose={props.onClose}
      title="Command palette"
      query={props.query}
      setQuery={props.setQuery}
      inputRef={props.inputRef}
      inputPlaceholder="Search commands..."
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
          void props.onRun(props.commands()[props.activeIndex()]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <Show
        when={props.commands().length > 0}
        fallback={
          <EmptyState class="command-palette__empty" message="No matches" />
        }
      >
        <ActionListbox
          options={commandOptions()}
          selectedValue={activeCommandId()}
          onSelect={(option) => void props.onRun(option.data)}
          ariaLabel="Command results"
          class="command-palette__list"
          itemClass="command-palette__item"
          itemLabelClass="command-palette__label"
          itemDescriptionClass="command-palette__hint"
        />
      </Show>
    </SearchDialog>
  );
};
