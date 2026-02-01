import { render, screen } from "@solidjs/testing-library";
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

describe("App perf HUD", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows perf HUD when enabled", async () => {
    localStorage.setItem("sandpaper:perf", "1");
    render(() => <App />);
    expect(await screen.findByText("Perf")).toBeInTheDocument();
  });
});
