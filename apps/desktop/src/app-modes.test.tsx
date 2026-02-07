import { render, screen, waitFor } from "@solidjs/testing-library";
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

    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(await screen.findByText("Quick capture")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Review mode")).toBeInTheDocument();
  });

  it("restores focus to the mode input when switching modes", async () => {
    const user = userEvent.setup();
    render(() => <App />);
    await screen.findByText(/saved/i);

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const captureInput = (await screen.findByPlaceholderText(
      "Capture a thought, link, or task..."
    )) as HTMLTextAreaElement;

    await waitFor(() => {
      expect(document.activeElement).toBe(captureInput);
    });

    await user.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => {
      const editorInputs = screen.getAllByPlaceholderText("Write something...");
      expect(
        editorInputs.some((input) => document.activeElement === input)
      ).toBe(true);
    });
  });
});
