import { For, Show, type Accessor } from "solid-js";
import type { UnlinkedReference } from "../../entities/page/model/backlink-types";

type UnlinkedReferencesPaneProps = {
  query: Accessor<string>;
  references: Accessor<UnlinkedReference[]>;
  onLink: (ref: UnlinkedReference) => void;
};

export const UnlinkedReferencesPane = (props: UnlinkedReferencesPaneProps) => {
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
        <div class="unlinked-list">
          <For each={props.references()}>
            {(ref) => (
              <div class="unlinked-item">
                <div class="unlinked-item__title">{ref.pageTitle}</div>
                <div class="unlinked-item__snippet">{ref.snippet}</div>
                <button
                  class="unlinked-item__action"
                  type="button"
                  onClick={() => props.onLink(ref)}
                >
                  Link it
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
};
