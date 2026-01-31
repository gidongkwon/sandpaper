import { fireEvent, render, screen, within } from "@solidjs/testing-library";
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

describe("App markdown display", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("renders inline markdown links in display mode", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "See [Docs](https://example.com) for details" }
    });
    fireEvent.blur(firstInput);

    const link = await screen.findByRole("link", { name: "Docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("renders basic markdown lists in display mode", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "- Alpha\n- Beta" }
    });
    fireEvent.blur(firstInput);

    const alpha = await screen.findByText("Alpha");
    const display = alpha.closest(".block__display") as HTMLElement;
    expect(display).not.toBeNull();
    const scope = within(display);
    const list = scope.getByRole("list");
    expect(list.tagName.toLowerCase()).toBe("ul");
    expect(scope.getAllByRole("listitem")).toHaveLength(2);
  });
});
