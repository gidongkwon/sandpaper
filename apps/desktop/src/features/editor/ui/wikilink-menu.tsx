import { For, Show } from "solid-js";
import type { PageSummary } from "../../../entities/page/model/page-types";
import type { CaretPosition } from "../../../shared/model/position";
import { SuggestionPopover } from "../../../shared/ui/suggestion-popover";

type WikilinkMenuProps = {
  open: boolean;
  position: CaretPosition | null;
  matches: PageSummary[];
  activePageUid: string;
  resolvePageUid: (value: string) => string;
  createLabel: string | null;
  query: string;
  onSelect: (title: string) => void;
  onCreate: (title: string) => void;
};

export const WikilinkMenu = (props: WikilinkMenuProps) => {
  return (
    <SuggestionPopover
      open={props.open}
      position={props.position}
      title="Link suggestions"
      listLabel="Wikilink suggestions"
      class="wikilink-menu"
      listClass="wikilink-menu__list"
    >
      <For each={props.matches}>
        {(page) => {
          const label = page.title || "Untitled";
          const insertTitle = page.title || page.uid;
          return (
            <button
              class="wikilink-menu__item"
              type="button"
              aria-label={label}
              onClick={() => props.onSelect(insertTitle)}
            >
              <span class="wikilink-menu__label">{label}</span>
              <Show
                when={
                  props.resolvePageUid(page.uid) ===
                  props.resolvePageUid(props.activePageUid)
                }
              >
                <span class="wikilink-menu__meta">Current</span>
              </Show>
            </button>
          );
        }}
      </For>
      <Show when={props.createLabel}>
        {(label) => (
          <button
            class="wikilink-menu__item wikilink-menu__item--create"
            type="button"
            onClick={() => props.onCreate(props.query)}
          >
            {label()}
          </button>
        )}
      </Show>
    </SuggestionPopover>
  );
};
