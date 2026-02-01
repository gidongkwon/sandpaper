import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
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

describe("App code block preview", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows a language badge and copies code content", async () => {
    const user = userEvent.setup();

    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "```js console.log('hi')" }
    });
    fireEvent.blur(firstInput);

    const previewTitle = await screen.findByText("Code preview");
    const preview = previewTitle.closest(".block-renderer--code") as HTMLElement;
    expect(preview).not.toBeNull();

    const scope = within(preview);
    expect(scope.getByText("JS")).toBeInTheDocument();

    const copyButton = scope.getByRole("button", { name: /copy/i });
    await user.click(copyButton);

    await waitFor(() => {
      expect(copyButton).toHaveTextContent("Copied");
    });
  });
});
