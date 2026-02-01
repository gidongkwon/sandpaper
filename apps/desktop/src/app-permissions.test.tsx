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

import App from "./app/app";

describe("Permission audit view", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("highlights missing and unused permissions", async () => {
    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: /open settings/i }));
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));

    const missing = await screen.findAllByText(/network/i, {
      selector: ".settings-permission"
    });
    expect(missing[0]).toHaveClass("is-missing");

    const unused = await screen.findAllByText(/clipboard/i, {
      selector: ".settings-permission"
    });
    expect(unused[0]).toHaveClass("is-unused");
  });
});
