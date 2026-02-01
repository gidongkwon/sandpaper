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

describe("App topbar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows sync status and autosave with settings button", async () => {
    const user = userEvent.setup();
    render(() => <App />);

    expect(await screen.findByText("Desktop only")).toBeInTheDocument();
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(await screen.findByRole("dialog", { name: /settings/i })).toBeInTheDocument();
  });
});
