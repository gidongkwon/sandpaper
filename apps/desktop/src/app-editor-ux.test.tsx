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

import App from "./app/app";

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
    const initialDisplayText = await screen.findByText("Sandpaper outline prototype");
    const initialBlock = initialDisplayText.closest(".block");
    expect(initialBlock).not.toBeNull();
    const firstInput = initialBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;
    const getInput = () =>
      document.querySelector(
        `textarea[data-block-id="${blockId}"]`
      ) as HTMLTextAreaElement | null;
    fireEvent.input(getInput() as HTMLTextAreaElement, {
      target: { value: "Hello world" }
    });

    const displayText = await screen.findByText("Hello world");
    const display = displayText.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    await userEvent.click(display);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-block-id")).toBe(blockId);
    });
    expect(getInput()?.selectionStart).toBe("Hello world".length);
    expect(getInput()?.selectionEnd).toBe("Hello world".length);
  });

  it("preserves caret position when exiting edit mode with Escape", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const initialDisplayText = await screen.findByText("Sandpaper outline prototype");
    const initialBlock = initialDisplayText.closest(".block");
    expect(initialBlock).not.toBeNull();
    const firstInput = initialBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;
    const getInput = () =>
      document.querySelector(
        `textarea[data-block-id="${blockId}"]`
      ) as HTMLTextAreaElement | null;
    fireEvent.input(getInput() as HTMLTextAreaElement, {
      target: { value: "Hello world" }
    });
    fireEvent.focus(getInput() as HTMLTextAreaElement);
    getInput()?.setSelectionRange(2, 2);

    fireEvent.keyDown(getInput() as HTMLTextAreaElement, { key: "Escape" });
    expect(document.activeElement?.getAttribute("data-block-id")).not.toBe(blockId);

    const displayText = await screen.findByText("Hello world");
    const display = displayText.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    await userEvent.click(display);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-block-id")).toBe(blockId);
    });
    expect(getInput()?.selectionStart).toBe(2);
    expect(getInput()?.selectionEnd).toBe(2);
  });

  it("shows slash command menu and inserts command text", async () => {
    const user = userEvent.setup();

    render(() => <App />);
    await screen.findByText(/saved/i);

    const displayText = await screen.findByText("Sandpaper outline prototype");
    const sourceBlock = displayText.closest(".block");
    expect(sourceBlock).not.toBeNull();
    const firstInput = sourceBlock?.querySelector(
      'textarea[data-block-id]'
    ) as HTMLTextAreaElement | null;
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    const blockId = firstInput.dataset.blockId;
    expect(blockId).toBeTruthy();
    if (!blockId) return;
    const getInput = () =>
      document.querySelector(
        `textarea[data-block-id="${blockId}"]`
      ) as HTMLTextAreaElement | null;
    const display = sourceBlock?.querySelector(".block__display") as HTMLElement;
    await user.click(display);
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.getAttribute("data-block-id")).toBe(blockId);
    });
    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    expect(getInput()?.value).toContain("/");
    const menu = await screen.findByText("Commands");
    const menuScope = within(menu.closest(".slash-menu") as HTMLElement);
    await user.click(menuScope.getByRole("button", { name: "Link to page" }));
    await waitFor(() => {
      expect(getInput()?.value).toContain("[[Page]]");
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, {
      target: { value: `${getInput()?.value ?? ""}/` }
    });
    const menuAgain = await screen.findByText("Commands");
    const menuAgainScope = within(menuAgain.closest(".slash-menu") as HTMLElement);
    await user.click(menuAgainScope.getByRole("button", { name: "Insert date" }));
    await waitFor(() => {
      expect(getInput()?.value).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "/" } });
    const menuHeading = await screen.findByText("Commands");
    const menuHeadingScope = within(menuHeading.closest(".slash-menu") as HTMLElement);
    await user.click(menuHeadingScope.getByRole("button", { name: "Heading 1" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("# ")).toBe(true);
    });

    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "Follow up" } });
    fireEvent.input(getInput() as HTMLTextAreaElement, { target: { value: "Follow up/" } });
    const menuTask = await screen.findByText("Commands");
    const menuTaskScope = within(menuTask.closest(".slash-menu") as HTMLElement);
    await user.click(menuTaskScope.getByRole("button", { name: "To-do" }));
    await waitFor(() => {
      expect((getInput()?.value ?? "").startsWith("- [ ] ")).toBe(true);
    });
  });

  it("does not show the old block hover toolbar actions", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    expect(screen.queryByRole("button", { name: "Insert block below" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link to page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate block" })).toBeNull();
  });

  it("keeps quick capture open and refocuses composer after sending", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    ) as HTMLTextAreaElement;
    await user.type(captureInput, "Quick note");
    fireEvent.keyDown(captureInput, { key: "Enter" });

    await waitFor(() => {
      expect(captureInput.value).toBe("");
      expect(document.activeElement).toBe(captureInput);
    });
    expect(screen.getByRole("button", { name: "Capture" })).toHaveClass(
      "is-active"
    );
    expect(await screen.findByDisplayValue("Quick note")).toBeInTheDocument();
  });

  it("allows editing captured items before returning to editor", async () => {
    render(() => <App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = screen.getByPlaceholderText(
      "Capture a thought, link, or task..."
    );
    await user.type(captureInput, "Quick note");
    await user.click(screen.getByRole("button", { name: "Send capture" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(captureInput);
    });

    const capturedItemInput = (await screen.findByRole("textbox", {
      name: "Captured item 1"
    })) as HTMLTextAreaElement;
    await user.click(capturedItemInput);
    await user.clear(capturedItemInput);
    await user.type(capturedItemInput, "Quick note updated");

    await user.click(screen.getByRole("button", { name: "Editor" }));

    let newInput: HTMLTextAreaElement | undefined;
    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText(
        "Write something..."
      ) as HTMLTextAreaElement[];
      newInput = inputs.find((input) => input.value === "Quick note updated");
      expect(newInput).toBeDefined();
      expect(document.activeElement).toBe(newInput);
    });
    const block = newInput?.closest(".block");
    expect(block).not.toBeNull();
    expect(block).toHaveClass("is-highlighted");
  });
});
