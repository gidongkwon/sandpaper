import { Show, type Accessor, type Component, type JSX } from "solid-js";
import type { SyncStatus } from "../../entities/sync/model/sync-types";

type SidebarPanelProps = {
  open: Accessor<boolean>;
  sectionJump: Component<{ id: string; label: string }>;
  footerLabel: Accessor<string>;
  connectionState: Accessor<SyncStatus["state"]>;
  connectionLabel: Accessor<string>;
  connectionDetail: Accessor<string>;
  children: JSX.Element;
};

export const SidebarPanel = (props: SidebarPanelProps) => {
  return (
    <aside class={`sidebar ${props.open() ? "is-open" : ""}`}>
      <Show when={props.open()}>
        <props.sectionJump id="sidebar" label="Sidebar" />
      </Show>
      {props.children}
      <div class="sidebar__footer">
        <span>{props.footerLabel()}</span>
        <span class="sidebar__footer-sep">•</span>
        <span
          class={`sidebar__connection-indicator is-${props.connectionState()}`}
          data-status-label={props.connectionLabel()}
          title={props.connectionDetail()}
          role="status"
          aria-label={props.connectionLabel()}
        >
          <span class="sidebar__connection-dot" />
        </span>
      </div>
    </aside>
  );
};
