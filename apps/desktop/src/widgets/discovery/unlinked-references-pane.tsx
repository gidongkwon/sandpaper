import { Show, createMemo, type Accessor } from "solid-js";
import type { UnlinkedReference } from "../../entities/page/model/backlink-types";
import { ActionListbox, type ActionListboxOption } from "../../shared/ui/action-listbox";

type UnlinkedReferencesPaneProps = {
  query: Accessor<string>;
  references: Accessor<UnlinkedReference[]>;
  onLink: (ref: UnlinkedReference) => void;
};

export const UnlinkedReferencesPane = (props: UnlinkedReferencesPaneProps) => {
  const referenceOptions = createMemo<ActionListboxOption<UnlinkedReference>[]>(() =>
    props.references().map((ref) => ({
      value: `${ref.pageUid}:${ref.blockId}`,
      label: ref.pageTitle,
      description: ref.snippet,
      data: ref
    }))
  );

  return (
    <Show
      when={props.query().trim().length === 0 && props.references().length > 0}
    >
      <div class="sidebar__section">
        <div class="sidebar__section-header">
          <span class="sidebar__section-title">Unlinked references</span>
          <span class="sidebar__section-count">
            {props.references().length}
          </span>
        </div>
        <ActionListbox
          options={referenceOptions()}
          onSelect={(option) => props.onLink(option.data)}
          ariaLabel="Unlinked references"
          class="unlinked-list"
          itemClass="unlinked-item"
          itemLabelClass="unlinked-item__title"
          itemDescriptionClass="unlinked-item__snippet"
        />
      </div>
    </Show>
  );
};
