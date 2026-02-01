import type { Accessor, JSX } from "solid-js";

type EditorWorkspaceProps = {
  sidebarOpen: Accessor<boolean>;
  backlinksOpen: Accessor<boolean>;
  sidebar: JSX.Element;
  editor: JSX.Element;
  backlinks: JSX.Element;
  pluginPanel: JSX.Element;
};

export const EditorWorkspace = (props: EditorWorkspaceProps) => {
  return (
    <div class={`workspace ${props.sidebarOpen() ? "" : "sidebar-collapsed"}`}>
      {props.sidebar}
      <main class={`main-pane ${props.backlinksOpen() ? "has-panel" : ""}`} role="main">
        {props.editor}
        {props.backlinks}
        {props.pluginPanel}
      </main>
    </div>
  );
};
