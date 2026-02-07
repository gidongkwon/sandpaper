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

describe("App topbar", () => {
  beforeEach(() => {
    clearStorage();
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

  it("shows shortcut hints by default and can hide status surfaces from settings", async () => {
    const user = userEvent.setup();
    render(() => <App />);

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    expect(screen.getByText(/ctrl\+k|cmd\+k/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    const statusToggle = await screen.findByRole("checkbox", {
      name: /show status chips/i
    });
    await user.click(statusToggle);

    expect(screen.queryByText("Desktop only")).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ctrl\+k|cmd\+k/i)).not.toBeInTheDocument();
  });
});
