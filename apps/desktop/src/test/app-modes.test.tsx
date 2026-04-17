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

import App from "../app/app";

const REFINE_MODE_LABEL = "Refine";

const getModeControl = (name: "Capture" | "Review" | "Refine" | "Editor") =>
  screen.getByRole("radio", { name: name === "Review" ? REFINE_MODE_LABEL : name });

const clearStorage = () => {
  const storage = window.localStorage;
  if (typeof storage?.clear === "function") {
    storage.clear();
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < (storage?.length ?? 0); i += 1) {
    const key = storage?.key(i);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    storage?.removeItem(key);
  }
};

describe("App modes", () => {
  beforeEach(() => {
    clearStorage();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("switches between capture and review panes", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    await user.click(getModeControl("Capture"));
    expect(await screen.findByPlaceholderText("Capture a thought, link, or task...")).toBeInTheDocument();

    await user.click(getModeControl("Review"));
    expect(await screen.findByText("No capture threads to refine.")).toBeInTheDocument();
  });

  it("hides the sidebar toggle outside editor mode", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    expect(screen.getByRole("button", { name: /hide sidebar/i })).toBeInTheDocument();

    await user.click(getModeControl("Capture"));
    await screen.findByPlaceholderText("Capture a thought, link, or task...");
    expect(screen.queryByRole("button", { name: /hide sidebar|show sidebar/i })).toBeNull();

    await user.click(getModeControl("Review"));
    await screen.findByText("No capture threads to refine.");
    expect(screen.queryByRole("button", { name: /hide sidebar|show sidebar/i })).toBeNull();

    await user.click(getModeControl("Editor"));
    expect(await screen.findByRole("button", { name: /hide sidebar/i })).toBeInTheDocument();
  });

  it("starts a view transition when switching modes from the topbar", async () => {
    const user = userEvent.setup();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn()
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition
    });

    render(() => <App />);
    await screen.findByText(/saved/i);

    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;
    await user.type(captureInput, "Transition thread");
    await user.click(screen.getByRole("button", { name: "Send capture" }));

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".focus-panel")).toHaveAttribute(
      "data-transition-slot",
      "capture"
    );

    await user.click(getModeControl("Review"));
    const destinationNote = await screen.findByRole("region", {
      name: "Destination note"
    });
    const reviewSurfaceBody = document.querySelector(".review-workbench__surface-body");

    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(destinationNote).toHaveAttribute("data-transition-slot", "editor");
    expect(
      destinationNote.querySelector('input[aria-label="Destination page"]')
    ).toBeInTheDocument();
    expect(destinationNote.querySelector(".review-workbench__editor-card")).toBeInTheDocument();
    expect(destinationNote.querySelector(".editor-pane")).toBeNull();
    expect(destinationNote.querySelector(".review-session-bar")).toHaveAttribute(
      "data-mode",
      "select"
    );
    expect(reviewSurfaceBody).toHaveAttribute("data-transition-slot", "capture");

    await user.click(getModeControl("Editor"));
    await waitFor(() => {
      expect(document.querySelector(".main-pane__editor")).toHaveAttribute(
        "data-transition-slot",
        "editor"
      );
      expect(document.querySelector(".main-pane__editor .editor-pane")).toHaveAttribute(
        "data-transition-slot",
        "editor"
      );
    });

    expect(startViewTransition).toHaveBeenCalledTimes(3);
  });

  it("skips view transitions when reduced motion is active", async () => {
    localStorage.setItem("sandpaper:motion-mode", "reduced");
    const user = userEvent.setup();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn()
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition
    });

    render(() => <App />);
    await screen.findByText(/saved/i);
    await waitFor(() => {
      expect(document.documentElement.dataset.motion).toBe("reduced");
    });

    await user.click(getModeControl("Capture"));
    expect(await screen.findByPlaceholderText("Capture a thought, link, or task...")).toBeInTheDocument();
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("restores focus to the mode input when switching modes", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await waitFor(() => {
      expect(document.activeElement).toBe(captureInput);
    });

    await user.click(getModeControl("Editor"));
    await waitFor(() => {
      const editorInputs = screen.getAllByPlaceholderText("Write something...");
      expect(
        editorInputs.some((input) => document.activeElement === input)
      ).toBe(true);
    });
  });

  it("supports Shift+Enter newlines in quick capture composer", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    await user.click(getModeControl("Capture"));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await user.type(captureInput, "Line 1");
    await user.type(captureInput, "{shift>}{enter}{/shift}Line 2");
    fireEvent.keyDown(captureInput, { key: "Enter" });

    await waitFor(() => {
      expect(document.querySelector(".capture-chat__bubble-text")).not.toBeNull();
    });
    const capturedItemDisplay = document.querySelector(
      ".capture-chat__bubble-text"
    ) as HTMLElement | null;
    expect(capturedItemDisplay).not.toBeNull();
    if (!capturedItemDisplay) return;
    await user.click(capturedItemDisplay);
    const capturedItem = (await screen.findByDisplayValue(/Line 1/u)) as HTMLTextAreaElement;
    expect(capturedItem.value).toContain("Line 1");
    expect(capturedItem.value).toContain("Line 2");
    expect(capturedItem.value).toContain("\n");
  });
});
