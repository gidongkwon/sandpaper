import { For, Show } from "solid-js";
import { SLASH_COMMANDS } from "../model/slash-commands";
import type { CaretPosition } from "../../../shared/model/position";

type SlashMenuProps = {
  open: boolean;
  position: CaretPosition | null;
  onSelect: (commandId: string) => void;
};

export const SlashMenu = (props: SlashMenuProps) => {
  return (
    <Show when={props.open && props.position}>
      {(position) => (
        <div
          class="slash-menu"
          style={{
            left: `${position().x}px`,
            top: `${position().y}px`
          }}
        >
          <div class="slash-menu__title">Commands</div>
          <div class="slash-menu__list">
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
          </div>
        </div>
      )}
    </Show>
  );
};
