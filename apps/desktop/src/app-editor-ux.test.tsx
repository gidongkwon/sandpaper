import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
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

describe("App editor UX", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("focuses the textarea at the end when clicking display", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    fireEvent.input(firstInput, { target: { value: "Hello world" } });

    const displayText = await screen.findByText("Hello world");
    const display = displayText.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    await userEvent.click(display);

    await waitFor(() => {
      expect(document.activeElement).toBe(firstInput);
    });
    expect(firstInput.selectionStart).toBe("Hello world".length);
    expect(firstInput.selectionEnd).toBe("Hello world".length);
  });

  it("preserves caret position when exiting edit mode with Escape", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    fireEvent.input(firstInput, { target: { value: "Hello world" } });
    fireEvent.focus(firstInput);
    firstInput.setSelectionRange(2, 2);

    fireEvent.keyDown(firstInput, { key: "Escape" });
    expect(document.activeElement).not.toBe(firstInput);

    const displayText = await screen.findByText("Hello world");
    const display = displayText.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    await userEvent.click(display);

    await waitFor(() => {
      expect(document.activeElement).toBe(firstInput);
    });
    expect(firstInput.selectionStart).toBe(2);
    expect(firstInput.selectionEnd).toBe(2);
  });

  it("shows slash command menu and inserts command text", async () => {
    const user = userEvent.setup();

    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    const displayText = await screen.findByText("Sandpaper outline prototype");
    const display = displayText.closest(".block__display") as HTMLElement;
    await user.click(display);
    await waitFor(() => {
      expect(document.activeElement).toBe(firstInput);
    });
    fireEvent.input(firstInput, { target: { value: "/" } });
    expect(firstInput.value).toContain("/");
    const menu = await screen.findByText("Commands");
    const menuScope = within(menu.closest(".slash-menu") as HTMLElement);
    await user.click(menuScope.getByRole("button", { name: "Link to page" }));
    await waitFor(() => {
      expect(firstInput.value).toContain("[[Page]]");
    });

    fireEvent.input(firstInput, { target: { value: `${firstInput.value}/` } });
    const menuAgain = await screen.findByText("Commands");
    const menuAgainScope = within(menuAgain.closest(".slash-menu") as HTMLElement);
    await user.click(menuAgainScope.getByRole("button", { name: "Insert date" }));
    await waitFor(() => {
      expect(firstInput.value).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    fireEvent.input(firstInput, { target: { value: "Follow up" } });
    fireEvent.input(firstInput, { target: { value: "Follow up/" } });
    const menuTask = await screen.findByText("Commands");
    const menuTaskScope = within(menuTask.closest(".slash-menu") as HTMLElement);
    await user.click(menuTaskScope.getByRole("button", { name: "Convert to task" }));
    await waitFor(() => {
      expect(firstInput.value.startsWith("- [ ] ")).toBe(true);
    });
  });

  it("duplicates a block from the toolbar", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;
    fireEvent.input(firstInput, { target: { value: "Duplicate me" } });

    const duplicateButtons = await screen.findAllByRole("button", { name: "Duplicate block" });
    await userEvent.click(duplicateButtons[0]);

    await waitFor(() => {
      const matches = screen.getAllByDisplayValue("Duplicate me");
      expect(matches.length).toBeGreaterThan(1);
    });
  });

  it("focuses and highlights the captured block", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    );
    await user.type(captureInput, "Quick note");
    await user.click(screen.getByRole("button", { name: "Add to Inbox" }));

    const newInput = (await screen.findByDisplayValue(
      "Quick note"
    )) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(newInput);
    });
    const block = newInput.closest(".block");
    expect(block).not.toBeNull();
    expect(block).toHaveClass("is-highlighted");
  });
});
