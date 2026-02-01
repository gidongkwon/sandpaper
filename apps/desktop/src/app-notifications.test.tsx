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

import { invoke } from "@tauri-apps/api/core";
import App from "./app/app";

describe("Notifications panel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("queues plugin errors for later review", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_vaults") {
        return Promise.resolve({
          active_id: "vault-1",
          vaults: [{ id: "vault-1", name: "Vault", path: "/vault" }]
        });
      }
      if (command === "get_active_page") return Promise.resolve("inbox");
      if (command === "list_pages") {
        return Promise.resolve([{ uid: "inbox", title: "Inbox" }]);
      }
      if (command === "load_page_blocks") {
        return Promise.resolve({
          page_uid: "inbox",
          title: "Inbox",
          blocks: [{ uid: "b1", text: "Hello", indent: 0 }]
        });
      }
      if (command === "list_page_wikilink_backlinks") return Promise.resolve([]);
      if (command === "list_plugins_command") return Promise.resolve([]);
      if (command === "load_plugins_command") {
        return Promise.reject(new Error("runtime failed"));
      }
      if (command === "vault_key_status") {
        return Promise.resolve({
          configured: false,
          kdf: null,
          iterations: null,
          salt_b64: null
        });
      }
      if (command === "get_sync_config") {
        return Promise.resolve({
          server_url: null,
          vault_id: null,
          device_id: null,
          key_fingerprint: null,
          last_push_cursor: 0,
          last_pull_cursor: 0
        });
      }
      if (command === "review_queue_summary") {
        return Promise.resolve({ due_count: 0, next_due_at: null });
      }
      if (command === "list_review_queue_due") return Promise.resolve([]);
      if (command === "save_page_blocks") return Promise.resolve(null);
      if (command === "write_shadow_markdown") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__ = {};

    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: /open settings/i }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("button", { name: /reload plugins/i }));
    fireEvent.click(screen.getByRole("button", { name: /open notifications/i }));

    const dialog = await screen.findByRole("dialog", { name: /notifications/i });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText(/plugin error/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/runtime failed/i)).toBeInTheDocument();
  });
});
