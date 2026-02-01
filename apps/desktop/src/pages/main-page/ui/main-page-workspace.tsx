import { Show, type Accessor } from "solid-js";
import type { Mode } from "../../../shared/model/mode";
import type { createSectionJump } from "../../../widgets/section-jump/section-jump";
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

type PropsOf<T> = T extends (props: infer P) => unknown ? P : never;

type SidebarContentProps = PropsOf<typeof SidebarContent>;
type SectionJumpComponents = ReturnType<typeof createSectionJump>;

type MainPageWorkspaceProps = {
  mode: Accessor<Mode>;
  sectionJump: {
    SectionJump: SectionJumpComponents["SectionJump"];
    SectionJumpLink: SectionJumpComponents["SectionJumpLink"];
  };
  sidebarOpen: Accessor<boolean>;
  backlinksOpen: Accessor<boolean>;
  sidebar: {
    footerLabel: Accessor<string>;
    search: SidebarContentProps["search"];
    unlinked: SidebarContentProps["unlinked"];
    pages: SidebarContentProps["pages"];
  };
  editor: PropsOf<typeof EditorPane>;
  backlinksToggle: PropsOf<typeof BacklinksToggle>;
  backlinks: PropsOf<typeof BacklinksPanel>;
  pluginPanel: PropsOf<typeof PluginPanelWidget>;
  capture: PropsOf<typeof CapturePane>;
  review: PropsOf<typeof ReviewPane>;
};

export const MainPageWorkspace = (props: MainPageWorkspaceProps) => {
  return (
    <Show
      when={props.mode() === "editor"}
      fallback={
        <FocusPanel
          mode={props.mode}
          sectionJump={props.sectionJump.SectionJumpLink}
          capture={<CapturePane {...props.capture} />}
          review={<ReviewPane {...props.review} />}
        />
      }
    >
      <EditorWorkspace
        sidebarOpen={props.sidebarOpen}
        backlinksOpen={props.backlinksOpen}
        sidebar={
          <SidebarPanel
            open={props.sidebarOpen}
            sectionJump={props.sectionJump.SectionJumpLink}
            footerLabel={props.sidebar.footerLabel}
          >
            <SidebarContent
              search={props.sidebar.search}
              unlinked={props.sidebar.unlinked}
              pages={props.sidebar.pages}
            />
          </SidebarPanel>
        }
        editor={
          <div class="main-pane__editor">
            <props.sectionJump.SectionJump id="editor" label="Editor" />
            <EditorPane {...props.editor} />
          </div>
        }
        backlinks={
          <>
            <BacklinksToggle {...props.backlinksToggle} />
            <BacklinksPanel {...props.backlinks} />
          </>
        }
        pluginPanel={<PluginPanelWidget {...props.pluginPanel} />}
      />
    </Show>
  );
};
