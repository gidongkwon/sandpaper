import { render, screen } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { Mode } from "../../../shared/model/mode";
import {
  MainPageProvider,
  type MainPageContextValue
} from "../model/main-page-context";

vi.mock("../../../widgets/editor/editor-pane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />
}));
vi.mock("../../../widgets/sidebar/sidebar-content", () => ({
  SidebarContent: () => <div data-testid="sidebar-content" />
}));
vi.mock("../../../widgets/sidebar/sidebar-panel", () => ({
  SidebarPanel: (props: { children: JSX.Element }) => (
    <div data-testid="sidebar-panel">{props.children}</div>
  )
}));
vi.mock("../../../widgets/backlinks/backlinks-toggle", () => ({
  BacklinksToggle: () => <div data-testid="backlinks-toggle" />
}));
vi.mock("../../../widgets/backlinks/backlinks-panel", () => ({
  BacklinksPanel: () => <div data-testid="backlinks-panel" />
}));
vi.mock("../../../widgets/plugins/plugin-panel", () => ({
  PluginPanelWidget: () => <div data-testid="plugin-panel" />
}));
vi.mock("../../../widgets/capture/capture-pane", () => ({
  CapturePane: () => <div data-testid="capture-pane" />
}));
vi.mock("../../../widgets/review/review-pane", () => ({
  ReviewPane: () => <div data-testid="review-pane" />
}));
vi.mock("../../../widgets/focus-panel/focus-panel", () => ({
  FocusPanel: (props: { capture: JSX.Element; review: JSX.Element }) => (
    <div data-testid="focus-panel">
      {props.capture}
      {props.review}
    </div>
  )
}));
vi.mock("../../../widgets/workspace/editor-workspace", () => ({
  EditorWorkspace: (props: {
    sidebar: JSX.Element;
    editor: JSX.Element;
    backlinks: JSX.Element;
    pluginPanel: JSX.Element;
  }) => (
    <div data-testid="editor-workspace">
      {props.sidebar}
      {props.editor}
      {props.backlinks}
      {props.pluginPanel}
    </div>
  )
}));

import { MainPageWorkspace } from "./main-page-workspace";

describe("MainPageWorkspace", () => {
  const buildContext = () => {
    const [mode, setMode] = createSignal<Mode>("editor");
    const [sidebarOpen] = createSignal(true);
    const [backlinksOpen] = createSignal(true);

    const workspace = {
      mode,
      sectionJump: {
        SectionJump: (props: { id: string; label: string }) => (
          <button data-testid={`jump-${props.id}`}>{props.label}</button>
        ),
        SectionJumpLink: (props: { id: string; label: string }) => (
          <button data-testid={`jump-link-${props.id}`}>{props.label}</button>
        )
      },
      sidebarOpen,
      backlinksOpen,
      sidebar: {
        footerLabel: () => "Vault",
        search: {} as MainPageContextValue["workspace"]["sidebar"]["search"],
        unlinked: {} as MainPageContextValue["workspace"]["sidebar"]["unlinked"],
        pages: {} as MainPageContextValue["workspace"]["sidebar"]["pages"]
      },
      editor: {} as MainPageContextValue["workspace"]["editor"],
      backlinksToggle: {} as MainPageContextValue["workspace"]["backlinksToggle"],
      backlinks: {} as MainPageContextValue["workspace"]["backlinks"],
      pluginPanel: {} as MainPageContextValue["workspace"]["pluginPanel"],
      capture: {} as MainPageContextValue["workspace"]["capture"],
      review: {} as MainPageContextValue["workspace"]["review"]
    } satisfies MainPageContextValue["workspace"];

    const value = {
      workspace,
      overlays: {} as MainPageContextValue["overlays"]
    } satisfies MainPageContextValue;

    return { value, setMode };
  };

  it("renders the editor workspace in editor mode", () => {
    const { value } = buildContext();

    render(() => (
      <MainPageProvider value={value}>
        <MainPageWorkspace />
      </MainPageProvider>
    ));

    expect(screen.getByTestId("editor-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("focus-panel")).not.toBeInTheDocument();
  });

  it("renders the focus panel in quick capture mode", async () => {
    const { value, setMode } = buildContext();

    render(() => (
      <MainPageProvider value={value}>
        <MainPageWorkspace />
      </MainPageProvider>
    ));

    setMode("quick-capture");

    expect(await screen.findByTestId("focus-panel")).toBeInTheDocument();
    expect(screen.getByTestId("capture-pane")).toBeInTheDocument();
  });
});
