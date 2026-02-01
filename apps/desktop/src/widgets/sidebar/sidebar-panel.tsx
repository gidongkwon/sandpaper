import { Show, type Accessor, type Component, type JSX } from "solid-js";

type SidebarPanelProps = {
  open: Accessor<boolean>;
  sectionJump: Component<{ id: string; label: string }>;
  footerLabel: Accessor<string>;
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
      </div>
    </aside>
  );
};
