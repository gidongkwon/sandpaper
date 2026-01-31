import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShadowWriter } from "./shadow-writer";

describe("createShadowWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches writes within the debounce window", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const writer = createShadowWriter({
      debounceMs: 50,
      maxDelayMs: 200,
      resolvePath: (pageId) => `/vault/${pageId}.md`,
      writeFile: async (path, content) => {
        writes.push({ path, content });
      }
    });

    writer.scheduleWrite("page-a", "first");
    writer.scheduleWrite("page-a", "second");

    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);

    expect(writes).toEqual([{ path: "/vault/page-a.md", content: "second" }]);
  });

  it("flushes after the max delay even with repeated updates", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const writer = createShadowWriter({
      debounceMs: 80,
      maxDelayMs: 120,
      resolvePath: (pageId) => `/vault/${pageId}.md`,
      writeFile: async (path, content) => {
        writes.push({ path, content });
      }
    });

    writer.scheduleWrite("page-a", "first");
    await vi.advanceTimersByTimeAsync(60);
    writer.scheduleWrite("page-a", "second");
    await vi.advanceTimersByTimeAsync(60);

    expect(writes).toEqual([{ path: "/vault/page-a.md", content: "second" }]);
  });

  it("flushes immediately when requested", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const writer = createShadowWriter({
      debounceMs: 100,
      maxDelayMs: 200,
      resolvePath: (pageId) => `/vault/${pageId}.md`,
      writeFile: async (path, content) => {
        writes.push({ path, content });
      }
    });

    writer.scheduleWrite("page-a", "first");
    await writer.flush();

    expect(writes).toEqual([{ path: "/vault/page-a.md", content: "first" }]);
  });

  it("retries failed writes and keeps pending items", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    let attempts = 0;
    const writer = createShadowWriter({
      debounceMs: 50,
      maxDelayMs: 200,
      resolvePath: (pageId) => `/vault/${pageId}.md`,
      writeFile: async (path, content) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("fail");
        }
        writes.push({ path, content });
      }
    });

    writer.scheduleWrite("page-a", "first");

    await vi.advanceTimersByTimeAsync(50);

    expect(writes).toHaveLength(0);
    expect(writer.getPendingCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(50);

    expect(writes).toEqual([{ path: "/vault/page-a.md", content: "first" }]);
    expect(writer.getPendingCount()).toBe(0);
  });

  it("notifies when pending count changes", async () => {
    const pendingCounts: number[] = [];
    const writer = createShadowWriter({
      debounceMs: 40,
      maxDelayMs: 120,
      resolvePath: (pageId) => `/vault/${pageId}.md`,
      writeFile: async () => {},
      onPendingChange: (count) => pendingCounts.push(count)
    });

    writer.scheduleWrite("page-a", "first");

    expect(pendingCounts).toEqual([1]);

    await vi.advanceTimersByTimeAsync(40);

    expect(pendingCounts).toEqual([1, 0]);
  });
});
