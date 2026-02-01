import { fireEvent, render, screen } from "@solidjs/testing-library";
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

import { invoke } from "@tauri-apps/api/core";
import App from "./app/app";

describe("Shadow writer queue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows queued shadow writes in settings", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);

    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "save_page_blocks") return Promise.resolve(null);
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    const inputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inputs[0], { target: { value: "Shadow queue" } });

    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    fireEvent.click(screen.getByRole("button", { name: "Vault" }));

    expect(screen.getByText(/shadow write queue/i)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/i)).toBeInTheDocument();
  });
});
