import { createMemo, Show } from "solid-js";
import type { PageSummary } from "../../../entities/page/model/page-types";
import type { CaretPosition } from "../../../shared/model/position";
import { ActionListbox, type ActionListboxOption } from "../../../shared/ui/action-listbox";
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
  const options = createMemo<
    ActionListboxOption<
      | { kind: "page"; title: string; isCurrent: boolean }
      | { kind: "create"; query: string }
    >[]
  >(() => {
    const pageOptions = props.matches.map((page) => {
      const label = page.title || "Untitled";
      const insertTitle = page.title || page.uid;
      return {
        value: `page:${page.uid}`,
        label,
        data: {
          kind: "page" as const,
          title: insertTitle,
          isCurrent:
            props.resolvePageUid(page.uid) === props.resolvePageUid(props.activePageUid)
        }
      };
    });
    if (!props.createLabel) return pageOptions;
    return [
      ...pageOptions,
      {
        value: `create:${props.query}`,
        label: props.createLabel,
        data: {
          kind: "create" as const,
          query: props.query
        }
      }
    ];
  });

  return (
    <SuggestionPopover
      open={props.open}
      position={props.position}
      title="Link suggestions"
      class="wikilink-menu"
      listClass="wikilink-menu__list"
    >
      <ActionListbox
        ariaLabel="Wikilink suggestions"
        variant="command"
        class="wikilink-menu__options"
        itemClass={(option) =>
          option.data.kind === "create"
            ? "wikilink-menu__item wikilink-menu__item--create"
            : "wikilink-menu__item"
        }
        options={options()}
        onSelect={(option) => {
          if (option.data.kind === "create") {
            props.onCreate(option.data.query);
            return;
          }
          props.onSelect(option.data.title);
        }}
        renderLabel={(option) => (
          <Show
            when={option.data.kind === "page"}
            fallback={<span class="wikilink-menu__label">{option.label}</span>}
          >
            <span class="wikilink-menu__item-row">
              <span class="wikilink-menu__label">{option.label}</span>
              <Show when={option.data.kind === "page" && option.data.isCurrent}>
                <span class="wikilink-menu__meta">Current</span>
              </Show>
            </span>
          </Show>
        )}
      />
    </SuggestionPopover>
  );
};
