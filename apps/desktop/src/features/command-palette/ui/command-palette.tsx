import { For, Show, type Accessor, type Setter } from "solid-js";
import { EmptyState } from "../../../shared/ui/empty-state";
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
        <For each={props.commands()}>
          {(command, index) => (
            <button
              class={`command-palette__item ${
                index() === props.activeIndex() ? "is-active" : ""
              }`}
              type="button"
              role="option"
              aria-selected={index() === props.activeIndex()}
              onMouseEnter={() => props.setActiveIndex(index())}
              onClick={() => void props.onRun(command)}
            >
              <span>{command.label}</span>
              <Show when={command.hint}>
                {(hint) => (
                  <span class="command-palette__hint">{hint()}</span>
                )}
              </Show>
            </button>
          )}
        </For>
      </Show>
    </SearchDialog>
  );
};
