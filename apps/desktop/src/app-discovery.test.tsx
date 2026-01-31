import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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

import App from "./app";

describe("App search & discovery", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("highlights matching search terms in results", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search...");
    await userEvent.type(input, "Draft line 1");
    const highlights = await screen.findAllByText("Draft line 1", {
      selector: ".search-highlight"
    });
    expect(highlights.length).toBeGreaterThan(0);
  });

  it("stores search history and allows re-running searches", async () => {
    render(() => <App />);
    const input = screen.getByPlaceholderText("Search...");
    await userEvent.type(input, "Draft line 2{enter}");
    const historyItem = await screen.findByRole("button", {
      name: "Recent search Draft line 2"
    });
    await userEvent.clear(input);
    await userEvent.click(historyItem);
    expect(input).toHaveValue("Draft line 2");
  });

  it("shows unlinked references and converts them to wikilinks", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("Project Atlas");
    await userEvent.click(
      screen.getByRole("button", { name: /create new page/i })
    );
    await screen.findByText("Project Atlas", { selector: ".editor-pane__title" });
    await userEvent.click(screen.getByRole("button", { name: "Open Inbox" }));
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inputs[0] as HTMLTextAreaElement, {
      target: { value: "Project Atlas meeting notes." }
    });

    const linkButton = await screen.findByRole("button", { name: "Link it" });
    await userEvent.click(linkButton);

    const inputsAfter = await screen.findAllByPlaceholderText("Write something...");
    await waitFor(() => {
      expect((inputsAfter[0] as HTMLTextAreaElement).value).toContain(
        "[[Project Atlas]]"
      );
    });
    promptSpy.mockRestore();
  });
});
