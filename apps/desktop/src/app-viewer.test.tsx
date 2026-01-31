import { render, screen } from "@solidjs/testing-library";
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

describe("App viewer mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows a read-only viewer with the current page content", async () => {
    const user = userEvent.setup();
    render(() => <App />);

    await screen.findByText(/saved/i);
    await user.click(screen.getByRole("button", { name: /viewer/i }));

    expect(
      await screen.findByText(/read-only viewer/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Sandpaper outline prototype")).toBeInTheDocument();
  });
});
