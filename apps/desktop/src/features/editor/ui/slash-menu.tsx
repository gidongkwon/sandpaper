import { For } from "solid-js";
import { SLASH_COMMANDS } from "../model/slash-commands";
import type { CaretPosition } from "../../../shared/model/position";
import { SuggestionPopover } from "../../../shared/ui/suggestion-popover";

type SlashMenuProps = {
  open: boolean;
  position: CaretPosition | null;
  onSelect: (commandId: string) => void;
};

export const SlashMenu = (props: SlashMenuProps) => {
  return (
    <SuggestionPopover
      open={props.open}
      position={props.position}
      title="Commands"
      listLabel="Slash commands"
      class="slash-menu"
      listClass="slash-menu__list"
    >
      <For each={SLASH_COMMANDS}>
        {(command) => (
          <button
            class="slash-menu__item"
            onClick={() => props.onSelect(command.id)}
            type="button"
          >
            {command.label}
          </button>
        )}
      </For>
    </SuggestionPopover>
  );
};
