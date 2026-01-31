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

import App from "./app";

describe("App graph view", () => {
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

  it("renders a wikilink graph with mermaid", async () => {
    mermaidMocks.render.mockResolvedValueOnce({
      svg: "<svg data-testid=\"graph-svg\"></svg>",
      bindFunctions: undefined
    });

    render(() => <App />);
    await screen.findByText(/saved/i);

    const inputs = await screen.findAllByPlaceholderText("Write something...");
    fireEvent.input(inputs[0], {
      target: { value: "Linking to [[Travel]] for the trip." }
    });
    fireEvent.blur(inputs[0]);

    fireEvent.click(screen.getByRole("button", { name: /graph/i }));

    await waitFor(() => {
      expect(mermaidMocks.render).toHaveBeenCalled();
    });
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringContaining("mermaid-graph-"),
      expect.stringContaining("graph LR")
    );
    expect(await screen.findByTestId("graph-svg")).toBeInTheDocument();
  });
});
