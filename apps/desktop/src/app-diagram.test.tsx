import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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

const mermaidMocks = vi.hoisted(() => ({
  render: vi.fn(),
  initialize: vi.fn()
}));

vi.mock("mermaid", () => ({
  default: mermaidMocks
}));

import App from "./app/app";

describe("App diagram preview", () => {
  beforeEach(() => {
    localStorage.clear();
    mermaidMocks.render.mockReset();
    mermaidMocks.initialize.mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("renders mermaid svg output", async () => {
    mermaidMocks.render.mockResolvedValueOnce({
      svg: "<svg data-testid=\"diagram-svg\"></svg>",
      bindFunctions: undefined
    });
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "```mermaid graph TD Start-->End;" }
    });
    fireEvent.blur(firstInput);

    await waitFor(() => {
      expect(mermaidMocks.render).toHaveBeenCalled();
    });
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringContaining("mermaid-"),
      "graph TD Start-->End;"
    );
    expect(await screen.findByTestId("diagram-svg")).toBeInTheDocument();
  });

  it("shows a fallback error when diagram render fails", async () => {
    mermaidMocks.render.mockRejectedValueOnce(new Error("bad diagram"));
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    fireEvent.input(firstInput, {
      target: { value: "```mermaid graph TD" }
    });
    fireEvent.blur(firstInput);

    expect(
      await screen.findByText(/unable to render diagram preview/i)
    ).toBeInTheDocument();
  });
});
