import { For, Show } from "solid-js";
import type { CaretPosition } from "../../../shared/model/position";
import { EmptyState } from "../../../shared/ui/empty-state";
import { FloatingPanelPopover } from "../../../shared/ui/floating-panel-popover";

type LinkPreviewProps = {
  open: boolean;
  position: CaretPosition | null;
  title: string;
  blocks: string[];
  loading: boolean;
  onOpen: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

export const LinkPreview = (props: LinkPreviewProps) => {
  return (
    <FloatingPanelPopover
      open={props.open}
      position={props.position}
      title="Link preview"
      class="wikilink-preview"
      onMouseEnter={() => props.onMouseEnter()}
      onMouseLeave={() => props.onMouseLeave()}
    >
      <>
        <div class="wikilink-preview__header">
          <div class="wikilink-preview__title">
            {props.title || "Untitled"}
          </div>
          <button
            class="wikilink-preview__open"
            type="button"
            onClick={() => props.onOpen()}
          >
            Open
          </button>
        </div>
        <div class="wikilink-preview__body">
          <Show
            when={!props.loading}
            fallback={<div class="wikilink-preview__loading">Loading preview...</div>}
          >
            <Show
              when={props.blocks.length > 0}
              fallback={
                <EmptyState
                  class="wikilink-preview__empty"
                  message="No content yet."
                />
              }
            >
              <For each={props.blocks}>
                {(blockText) => (
                  <div class="wikilink-preview__block">{blockText}</div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </>
    </FloatingPanelPopover>
  );
};
