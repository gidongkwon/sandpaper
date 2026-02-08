import { render, screen, within, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: vi.fn()
  };
});

import App from "./app/app";

describe("App accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("opens command palette with Ctrl+K and runs a command", async () => {
    const user = userEvent.setup();
    render(() => <App />);

    await screen.findByText(/saved/i);
    await user.keyboard("{Control>}k{/Control}");

    const palette = await screen.findByRole("dialog", {
      name: "Command palette"
    });
    const input = within(palette).getByPlaceholderText("Search commands...");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    await user.type(input, "settings");
    await user.keyboard("{Enter}");

    await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    });
  });

  it("creates a block type showcase page from the command palette", async () => {
    const user = userEvent.setup();
    render(() => <App />);

    await screen.findByText(/saved/i);
    await user.keyboard("{Control>}k{/Control}");

    const palette = await screen.findByRole("dialog", {
      name: "Command palette"
    });
    const input = within(palette).getByPlaceholderText("Search commands...");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    await user.type(input, "all block types");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByText("Block Type Showcase", {
        selector: ".editor-pane__title"
      })
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Block Type Showcase", {
        selector: ".page-item__title"
      })
    ).toBeInTheDocument();
  });

  it("tabs between section jump points", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    const sidebarJump = screen.getByRole("button", { name: "Sidebar section" });
    const editorJump = screen.getByRole("button", { name: "Editor section" });

    sidebarJump.focus();
    expect(document.activeElement).toBe(sidebarJump);

    await user.tab();
    expect(document.activeElement).toBe(editorJump);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(sidebarJump);
  });
});
