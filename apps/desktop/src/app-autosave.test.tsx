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

import { invoke } from "@tauri-apps/api/core";
import App from "./app";

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("App autosave status", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows Saving until the DB write completes", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    const deferred = createDeferred<void>();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "save_page_blocks") return deferred.promise;
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    fireEvent.input(firstInput, { target: { value: "Autosave check" } });

    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();

    deferred.resolve(undefined);

    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeInTheDocument();
    });
  });

  it("shows a save failed message on write error", async () => {
    render(() => <App />);
    await screen.findByText(/saved/i);
    const inputs = await screen.findAllByPlaceholderText("Write something...");
    const firstInput = inputs[0] as HTMLTextAreaElement;

    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "save_page_blocks") {
        return Promise.reject(new Error("save failed"));
      }
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    fireEvent.input(firstInput, { target: { value: "Autosave fails" } });

    await waitFor(() => {
      expect(screen.getByText(/save failed/i)).toBeInTheDocument();
    });
  });
});
