import { ActionListbox } from "../../../shared/ui/action-listbox";
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
      class="slash-menu"
      listClass="slash-menu__list"
    >
      <ActionListbox
        ariaLabel="Slash commands"
        variant="command"
        class="slash-menu__options"
        itemClass="slash-menu__item"
        options={SLASH_COMMANDS.map((command) => ({
          value: command.id,
          label: command.label,
          data: command.id
        }))}
        onSelect={(option) => props.onSelect(option.data)}
      />
    </SuggestionPopover>
  );
};
