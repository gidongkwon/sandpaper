import { Show } from "solid-js";
import { BacklinksPanel } from "../../../widgets/backlinks/backlinks-panel";
import { BacklinksToggle } from "../../../widgets/backlinks/backlinks-toggle";
import { CapturePane } from "../../../widgets/capture/capture-pane";
import { EditorPane } from "../../../widgets/editor/editor-pane";
import { FocusPanel } from "../../../widgets/focus-panel/focus-panel";
import { PluginPanelWidget } from "../../../widgets/plugins/plugin-panel";
import { ReviewPane } from "../../../widgets/review/review-pane";
import { SidebarContent } from "../../../widgets/sidebar/sidebar-content";
import { SidebarPanel } from "../../../widgets/sidebar/sidebar-panel";
import { EditorWorkspace } from "../../../widgets/workspace/editor-workspace";
import { useMainPageContext } from "../model/main-page-context";

export const MainPageWorkspace = () => {
  const { workspace } = useMainPageContext();

  return (
    <Show
      when={workspace.mode() === "editor"}
      fallback={
        <FocusPanel
          mode={workspace.mode}
          sectionJump={workspace.sectionJump.SectionJumpLink}
          capture={<CapturePane {...workspace.capture} />}
          review={<ReviewPane {...workspace.review} />}
        />
      }
    >
      <EditorWorkspace
        sidebarOpen={workspace.sidebarOpen}
        backlinksOpen={workspace.backlinksOpen}
        sidebar={
          <SidebarPanel
            open={workspace.sidebarOpen}
            sectionJump={workspace.sectionJump.SectionJumpLink}
            footerLabel={workspace.sidebar.footerLabel}
            connectionState={workspace.sidebar.connectionState}
            connectionLabel={workspace.sidebar.connectionLabel}
            connectionDetail={workspace.sidebar.connectionDetail}
          >
            <SidebarContent
              search={workspace.sidebar.search}
              unlinked={workspace.sidebar.unlinked}
              pages={workspace.sidebar.pages}
            />
          </SidebarPanel>
        }
        editor={
          <div class="main-pane__editor">
            <workspace.sectionJump.SectionJump id="editor" label="Editor" />
            <EditorPane {...workspace.editor} />
          </div>
        }
        backlinks={
          <>
            <BacklinksToggle {...workspace.backlinksToggle} />
            <BacklinksPanel {...workspace.backlinks} />
          </>
        }
        pluginPanel={<PluginPanelWidget {...workspace.pluginPanel} />}
      />
    </Show>
  );
};
