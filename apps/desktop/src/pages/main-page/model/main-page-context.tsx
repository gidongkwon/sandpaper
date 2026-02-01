import {
  createContext,
  untrack,
  useContext,
  type Accessor,
  type JSX,
  type Setter
} from "solid-js";
import type { createSectionJump } from "../../../widgets/section-jump/section-jump";
import type { PageDialogMode } from "./page-dialog-utils";
import { BacklinksPanel } from "../../../widgets/backlinks/backlinks-panel";
import { BacklinksToggle } from "../../../widgets/backlinks/backlinks-toggle";
import { CapturePane } from "../../../widgets/capture/capture-pane";
import { CommandPalette } from "../../../features/command-palette/ui/command-palette";
import { EditorPane } from "../../../widgets/editor/editor-pane";
import { PermissionPromptModal } from "../../../widgets/permissions/permission-prompt-modal";
import { PluginPanelWidget } from "../../../widgets/plugins/plugin-panel";
import { ReviewPane } from "../../../widgets/review/review-pane";
import { SettingsModal } from "../../../widgets/settings/settings-modal";
import { SidebarContent } from "../../../widgets/sidebar/sidebar-content";
import type { Mode } from "../../../shared/model/mode";

type PropsOf<T> = T extends (props: infer P) => unknown ? P : never;

type SectionJumpComponents = ReturnType<typeof createSectionJump>;

type PageDialogState = {
  open: Accessor<boolean>;
  title: Accessor<string>;
  confirmLabel: Accessor<string>;
  confirmDisabled: Accessor<boolean>;
  onConfirm: () => void;
  onCancel: () => void;
  mode: Accessor<PageDialogMode>;
  value: Accessor<string>;
  setValue: Setter<string>;
};

export type MainPageWorkspaceState = {
  mode: Accessor<Mode>;
  sectionJump: {
    SectionJump: SectionJumpComponents["SectionJump"];
    SectionJumpLink: SectionJumpComponents["SectionJumpLink"];
  };
  sidebarOpen: Accessor<boolean>;
  backlinksOpen: Accessor<boolean>;
  sidebar: {
    footerLabel: Accessor<string>;
    search: PropsOf<typeof SidebarContent>["search"];
    unlinked: PropsOf<typeof SidebarContent>["unlinked"];
    pages: PropsOf<typeof SidebarContent>["pages"];
  };
  editor: PropsOf<typeof EditorPane>;
  backlinksToggle: PropsOf<typeof BacklinksToggle>;
  backlinks: PropsOf<typeof BacklinksPanel>;
  pluginPanel: PropsOf<typeof PluginPanelWidget>;
  capture: PropsOf<typeof CapturePane>;
  review: PropsOf<typeof ReviewPane>;
};

export type MainPageOverlaysState = {
  commandPalette: PropsOf<typeof CommandPalette>;
  settings: PropsOf<typeof SettingsModal>;
  pageDialog: PageDialogState;
  permissionPrompt: PropsOf<typeof PermissionPromptModal>;
};

export type MainPageContextValue = {
  workspace: MainPageWorkspaceState;
  overlays: MainPageOverlaysState;
};

const MainPageContext = createContext<MainPageContextValue | null>(null);

export const MainPageProvider = (props: {
  value: MainPageContextValue;
  children: JSX.Element;
}) => {
  // The context value is a stable object of accessors; avoid unnecessary tracking here.
  const value = untrack(() => props.value);
  return (
    <MainPageContext.Provider value={value}>
      {props.children}
    </MainPageContext.Provider>
  );
};

export const useMainPageContext = () => {
  const context = useContext(MainPageContext);
  if (!context) {
    throw new Error("MainPageContext not found");
  }
  return context;
};
