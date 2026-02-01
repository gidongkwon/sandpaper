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

import App from "./app/app";

describe("App modes", () => {
  beforeEach(() => {
    localStorage.clear();
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
});
