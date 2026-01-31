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

import { invoke } from "@tauri-apps/api/core";
import App from "./app";

describe("Sync activity log", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("records push and pull activity and allows copying", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/v1/ops/push")) {
        return {
          ok: true,
          json: async () => ({ accepted: 1, cursor: 1 })
        } as Response;
      }
      if (url.includes("/v1/ops/pull")) {
        return {
          ok: true,
          json: async () => ({ ops: [], nextCursor: 0 })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }));

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
        return Promise.resolve({
          loaded: [],
          blocked: [],
          commands: [],
          panels: [],
          toolbar_actions: [],
          renderers: []
        });
      }
      if (command === "vault_key_status") {
        return Promise.resolve({
          configured: true,
          kdf: "pbkdf2-sha256",
          iterations: 1,
          salt_b64: ""
        });
      }
      if (command === "get_sync_config") {
        return Promise.resolve({
          server_url: "https://sync.local",
          vault_id: "vault-1",
          device_id: "device-1",
          key_fingerprint: "abc",
          last_push_cursor: 0,
          last_pull_cursor: 0
        });
      }
      if (command === "list_sync_ops_since") {
        return Promise.resolve([
          { cursor: 1, op_id: "op-1", payload: "{}" }
        ]);
      }
      if (command === "set_sync_cursors") {
        return Promise.resolve({
          server_url: "https://sync.local",
          vault_id: "vault-1",
          device_id: "device-1",
          key_fingerprint: "abc",
          last_push_cursor: 1,
          last_pull_cursor: 0
        });
      }
      if (command === "store_sync_inbox_ops") return Promise.resolve(null);
      if (command === "apply_sync_inbox") {
        return Promise.resolve({ pages: [], applied: 0 });
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
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    const syncNow = screen.getByRole("button", { name: /sync now/i });
    fireEvent.click(syncNow);

    expect(await screen.findByText(/push/i)).toBeInTheDocument();
    expect(await screen.findByText(/pull/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy log/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
