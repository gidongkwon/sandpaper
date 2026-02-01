import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { EditorWorkspace } from "./editor-workspace";

describe("EditorWorkspace", () => {
  it("renders slots and updates layout classes", async () => {
    const [sidebarOpen, setSidebarOpen] = createSignal(false);
    const [backlinksOpen, setBacklinksOpen] = createSignal(false);

    const { container } = render(() => (
      <EditorWorkspace
        sidebarOpen={sidebarOpen}
        backlinksOpen={backlinksOpen}
        sidebar={<aside data-testid="sidebar" />}
        editor={<section data-testid="editor" />}
        backlinks={<div data-testid="backlinks" />}
        pluginPanel={<div data-testid="plugin" />}
      />
    ));

    const workspace = container.querySelector(".workspace");
    const mainPane = container.querySelector(".main-pane");

    expect(workspace).toBeInTheDocument();
    expect(mainPane).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    expect(screen.getByTestId("backlinks")).toBeInTheDocument();
    expect(screen.getByTestId("plugin")).toBeInTheDocument();
    expect(workspace?.classList.contains("sidebar-collapsed")).toBe(true);
    expect(mainPane?.classList.contains("has-panel")).toBe(false);

    setSidebarOpen(true);
    setBacklinksOpen(true);

    await waitFor(() => {
      expect(workspace?.classList.contains("sidebar-collapsed")).toBe(false);
      expect(mainPane?.classList.contains("has-panel")).toBe(true);
    });
  });
});
