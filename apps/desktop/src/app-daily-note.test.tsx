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

describe("App daily note auto-create", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 9, 0, 0));
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates today's daily note without changing the active page", async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    render(() => <App />);

    expect(
      await screen.findByText(today, { selector: ".page-item__title" })
    ).toBeInTheDocument();

    expect(
      await screen.findByText("Inbox", { selector: ".editor-pane__title" })
    ).toBeInTheDocument();
  });
});
