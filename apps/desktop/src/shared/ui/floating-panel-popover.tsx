import * as Popover from "@kobalte/core/popover";
import { Show, type JSX } from "solid-js";
import type { AnchorRect, CaretPosition } from "../model/position";

type FloatingPanelPopoverProps = {
  open: boolean;
  position?: CaretPosition | null;
  anchorRect?: AnchorRect | null;
  title: string;
  class?: string;
  placement?: "bottom-start" | "bottom-end";
  onClose?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: JSX.Element;
};

export const FloatingPanelPopover = (props: FloatingPanelPopoverProps) => {
  const anchorRect = () => {
    if (props.anchorRect) return props.anchorRect;
    if (props.position) {
      return {
        x: props.position.x,
        y: props.position.y,
        width: 0,
        height: 0
      } satisfies AnchorRect;
    }
    return null;
  };

  return (
    <Show when={props.open && anchorRect()}>
      {(rect) => (
        <Popover.Root
          open={true}
          modal={false}
          preventScroll={false}
          placement={props.placement ?? "bottom-start"}
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
                left: `${rect().x}px`,
                top: `${rect().y}px`,
                width: `${rect().width}px`,
                height: `${rect().height}px`
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
