import { render, screen } from "@solidjs/testing-library";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: vi.fn()
  };
});

import { invoke } from "@tauri-apps/api/core";
import { PluginBlockPreview } from "./plugin-block-preview";

describe("PluginBlockPreview", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("renders plugin content on mount in Tauri", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      plugin_id: "hn-top",
      renderer_id: "hn-top.block",
      block_uid: "b1",
      body: {
        kind: "list",
        items: ["Story 1", "Story 2"]
      }
    });

    render(() => (
      <PluginBlockPreview
        block={{ id: "b1", text: "```hn-top count=5 :: Loading HN top", indent: 0 }}
        renderer={{
          plugin_id: "hn-top",
          id: "hn-top.block",
          title: "Hacker News Top",
          kind: "block",
          languages: ["hn-top"]
        }}
        isTauri={() => true}
        onUpdateText={vi.fn()}
      />
    ));

    expect(await screen.findByText("Story 1")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "plugin_render_block",
      expect.objectContaining({
        pluginId: "hn-top",
        rendererId: "hn-top.block",
        blockUid: "b1"
      })
    );
  });
});
