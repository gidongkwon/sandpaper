import { fireEvent, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal, type Accessor } from "solid-js";
import { vi } from "vitest";
import { createSectionJump } from "./section-jump";

describe("createSectionJump", () => {
  it("opens the sidebar and focuses the search input", async () => {
    let sidebarOpen: Accessor<boolean> = () => false;
    let searchInput: HTMLInputElement | undefined;

    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });

    const user = userEvent.setup();

    render(() => {
      const [mode] = createSignal<"quick-capture" | "editor" | "review">("editor");
      const [sidebarOpenSignal, setSidebarOpenSignal] = createSignal(false);
      const [backlinksOpen] = createSignal(false);
      const [activeId] = createSignal<string | null>(null);
      sidebarOpen = sidebarOpenSignal;
      const { SectionJump } = createSectionJump({
        mode,
        sidebarOpen: sidebarOpenSignal,
        setSidebarOpen: setSidebarOpenSignal,
        backlinksOpen,
        setBacklinksOpen: () => {},
        activeId,
        getSearchInput: () => searchInput
      });
      return (
        <>
          <input ref={(el) => (searchInput = el)} />
          <SectionJump id="sidebar" label="Sidebar" />
        </>
      );
    });

    await user.click(screen.getByRole("button", { name: /sidebar section/i }));

    expect(sidebarOpen()).toBe(true);
    expect(document.activeElement).toBe(searchInput);

    rafSpy.mockRestore();
  });

  it("tabs between available sections", () => {
    render(() => {
      const [mode] = createSignal<"quick-capture" | "editor" | "review">("editor");
      const [sidebarOpen] = createSignal(true);
      const [backlinksOpen] = createSignal(false);
      const [activeId] = createSignal<string | null>(null);
      const { SectionJump } = createSectionJump({
        mode,
        sidebarOpen,
        setSidebarOpen: () => {},
        backlinksOpen,
        setBacklinksOpen: () => {},
        activeId,
        getSearchInput: () => undefined
      });
      return (
        <>
          <SectionJump id="sidebar" label="Sidebar" />
          <SectionJump id="editor" label="Editor" />
        </>
      );
    });

    const sidebarButton = screen.getByRole("button", {
      name: /sidebar section/i
    });
    const editorButton = screen.getByRole("button", { name: /editor section/i });

    sidebarButton.focus();
    fireEvent.keyDown(sidebarButton, { key: "Tab" });

    expect(document.activeElement).toBe(editorButton);
  });
});
