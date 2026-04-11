import * as Popover from "@kobalte/core/popover";
import { Show, type JSX } from "solid-js";
import type { CaretPosition } from "../model/position";

type SuggestionPopoverProps = {
  open: boolean;
  position: CaretPosition | null;
  title?: string;
  class?: string;
  listClass?: string;
  onClose?: () => void;
  children: JSX.Element;
};

export const SuggestionPopover = (props: SuggestionPopoverProps) => {
  return (
    <Show when={props.open && props.position}>
      {(position) => (
        <Popover.Root
          open={true}
          modal={false}
          preventScroll={false}
          placement="bottom-start"
          gutter={8}
          onOpenChange={(open) => {
            if (!open) props.onClose?.();
          }}
        >
          <Popover.Portal>
            <Popover.Anchor
              class="suggestion-popover__anchor"
              aria-hidden="true"
              style={{
                left: `${position().x}px`,
                top: `${position().y}px`
              }}
            />
            <Popover.Content
              class={`suggestion-popover ${props.class ?? ""}`.trim()}
              data-editor-suggestion-popover="true"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
              }}
            >
              <Show when={props.title}>
                {(title) => (
                  <Popover.Title class="suggestion-popover__title">
                    {title()}
                  </Popover.Title>
                )}
              </Show>
              <div class={`suggestion-popover__list ${props.listClass ?? ""}`.trim()}>
                {props.children}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Show>
  );
};
