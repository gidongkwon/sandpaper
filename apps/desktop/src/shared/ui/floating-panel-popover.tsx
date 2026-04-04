import * as Popover from "@kobalte/core/popover";
import { Show, type JSX } from "solid-js";
import type { CaretPosition } from "../model/position";

type FloatingPanelPopoverProps = {
  open: boolean;
  position: CaretPosition | null;
  title: string;
  class?: string;
  onClose?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: JSX.Element;
};

export const FloatingPanelPopover = (props: FloatingPanelPopoverProps) => {
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
              class="floating-panel-popover__anchor"
              aria-hidden="true"
              style={{
                left: `${position().x}px`,
                top: `${position().y}px`
              }}
            />
            <Popover.Content
              class={`floating-panel-popover ${props.class ?? ""}`.trim()}
              onMouseEnter={() => props.onMouseEnter?.()}
              onMouseLeave={() => props.onMouseLeave?.()}
            >
              <Popover.Title class="floating-panel-popover__title">
                {props.title}
              </Popover.Title>
              {props.children}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Show>
  );
};
