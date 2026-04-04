import * as DropdownMenu from "@kobalte/core/dropdown-menu";
import { For, Show } from "solid-js";

type ActionMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
};

type ActionMenuProps = {
  open: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  class?: string;
  itemClass?: string;
  items: ActionMenuItem[];
};

export const ActionMenu = (props: ActionMenuProps) => {
  return (
    <Show when={props.open && props.position}>
      {(position) => {
        const anchor = position();
        return (
          <DropdownMenu.Root
            open={true}
            placement="bottom-start"
            gutter={4}
            getAnchorRect={() => ({
              x: anchor.x,
              y: anchor.y,
              width: 0,
              height: 0
            })}
            onOpenChange={(open) => {
              if (!open) props.onClose();
            }}
          >
            <DropdownMenu.Portal>
            <DropdownMenu.Content
              class={`action-menu ${props.class ?? ""}`.trim()}
              onMouseDown={(event: MouseEvent) => event.stopPropagation()}
              onClick={(event: MouseEvent) => event.stopPropagation()}
            >
              <For each={props.items}>
                {(item) => (
                  <button
                    class={`action-menu__item ${props.itemClass ?? ""}`.trim()}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event: MouseEvent) => {
                      event.preventDefault();
                      event.stopPropagation();
                      item.onSelect();
                      props.onClose();
                    }}
                    onClick={(event: MouseEvent) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        );
      }}
    </Show>
  );
};
