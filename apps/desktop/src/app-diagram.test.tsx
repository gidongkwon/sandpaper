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

describe("App diagram preview", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("renders diagram nodes from mermaid content", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "```mermaid graph TD Start-->End;" }
    });
    fireEvent.blur(firstInput);

    const previewTitle = await screen.findByText("Diagram preview");
    const preview = previewTitle.closest(".block-renderer--diagram") as HTMLElement;
    expect(preview).not.toBeNull();

    const scope = within(preview);
    expect(scope.getByText("Start", { selector: ".diagram-node" })).toBeInTheDocument();
    expect(scope.getByText("End", { selector: ".diagram-node" })).toBeInTheDocument();
  });

  it("shows a fallback error when diagram render fails", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "```mermaid graph TD" }
    });
    fireEvent.blur(firstInput);

    expect(
      await screen.findByText(/unable to render diagram/i)
    ).toBeInTheDocument();
  });
});
