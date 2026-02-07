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

describe("App Fluent icons", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("uses fluent icon markers in topbar and sidebar controls", async () => {
    const user = userEvent.setup();
    const { container } = render(() => <App />);
    await screen.findByText(/saved/i);

    expect(
      screen
        .getByRole("button", { name: /hide sidebar/i })
        .querySelector("[data-fluent-icon]")
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /open notifications/i })
        .querySelector("[data-fluent-icon]")
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /open settings/i })
        .querySelector("[data-fluent-icon]")
    ).not.toBeNull();
    expect(container.querySelector(".sidebar__search [data-fluent-icon]")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /create new page/i })
        .querySelector("[data-fluent-icon]")
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(
      screen.getByRole("button", { name: "General" }).querySelector("[data-fluent-icon]")
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Vault" }).querySelector("[data-fluent-icon]")
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Sync" }).querySelector("[data-fluent-icon]")
    ).not.toBeNull();
  });
});
