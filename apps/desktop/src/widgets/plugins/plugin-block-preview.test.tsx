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
import { PluginBlockPreview, __clearPluginBlockCache } from "./plugin-block-preview";

describe("PluginBlockPreview", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    __clearPluginBlockCache();
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

  it("shows error message when view has no body", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      plugin_id: "hn-top",
      renderer_id: "hn-top.block",
      block_uid: "b1",
      status: "error",
      message: "Request failed (0): connect failed"
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

    expect(
      await screen.findByText("Request failed (0): connect failed")
    ).toBeInTheDocument();
  });

  it("reuses cached views to avoid re-render fetches", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      plugin_id: "hn-top",
      renderer_id: "hn-top.block",
      block_uid: "b1",
      cache: { ttlSeconds: 60 },
      body: {
        kind: "list",
        items: ["Story 1", "Story 2"]
      }
    });

    const props = {
      block: { id: "b1", text: "```hn-top count=5 :: Loading HN top", indent: 0 },
      renderer: {
        plugin_id: "hn-top",
        id: "hn-top.block",
        title: "Hacker News Top",
        kind: "block",
        languages: ["hn-top"]
      },
      isTauri: () => true,
      onUpdateText: vi.fn()
    };

    const { unmount } = render(() => <PluginBlockPreview {...props} />);
    expect(await screen.findByText("Story 1")).toBeInTheDocument();

    unmount();
    render(() => <PluginBlockPreview {...props} />);

    expect(await screen.findByText("Story 1")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
  });

  it("reuses cached view when cache_ts or summary changes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      plugin_id: "hn-top",
      renderer_id: "hn-top.block",
      block_uid: "b1",
      cache: { ttlSeconds: 60 },
      body: {
        kind: "list",
        items: ["Story 1"]
      },
      next_text:
        "```hn-top count=5 cache_ttl=60 cache_ts=2026-02-01T00:00:00Z :: HN top 5 at 00:00Z"
    });

    const renderer = {
      plugin_id: "hn-top",
      id: "hn-top.block",
      title: "Hacker News Top",
      kind: "block",
      languages: ["hn-top"]
    };
    const onUpdateText = vi.fn();

    const { unmount } = render(() => (
      <PluginBlockPreview
        block={{ id: "b1", text: "```hn-top count=5 :: Loading HN top", indent: 0 }}
        renderer={renderer}
        isTauri={() => true}
        onUpdateText={onUpdateText}
      />
    ));
    expect(await screen.findByText("Story 1")).toBeInTheDocument();

    unmount();
    render(() => (
      <PluginBlockPreview
        block={{
          id: "b1",
          text:
            "```hn-top count=5 cache_ttl=60 cache_ts=2026-02-01T01:00:00Z :: HN top 5 at 01:00Z",
          indent: 0
        }}
        renderer={renderer}
        isTauri={() => true}
        onUpdateText={onUpdateText}
      />
    ));

    expect(await screen.findByText("Story 1")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
  });

  it("refetches cached views after the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    vi.mocked(invoke)
      .mockResolvedValueOnce({
        plugin_id: "hn-top",
        renderer_id: "hn-top.block",
        block_uid: "b1",
        cache: { ttlSeconds: 1 },
        body: {
          kind: "list",
          items: ["Story 1", "Story 2"]
        }
      })
      .mockResolvedValueOnce({
        plugin_id: "hn-top",
        renderer_id: "hn-top.block",
        block_uid: "b1",
        cache: { ttlSeconds: 1 },
        body: {
          kind: "list",
          items: ["Story 3", "Story 4"]
        }
      });

    const props = {
      block: { id: "b1", text: "```hn-top count=5 :: Loading HN top", indent: 0 },
      renderer: {
        plugin_id: "hn-top",
        id: "hn-top.block",
        title: "Hacker News Top",
        kind: "block",
        languages: ["hn-top"]
      },
      isTauri: () => true,
      onUpdateText: vi.fn()
    };

    const { unmount } = render(() => <PluginBlockPreview {...props} />);
    await vi.runAllTimersAsync();
    expect(await screen.findByText("Story 1")).toBeInTheDocument();

    unmount();
    vi.advanceTimersByTime(2000);

    render(() => <PluginBlockPreview {...props} />);
    await vi.runAllTimersAsync();
    expect(await screen.findByText("Story 3")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
