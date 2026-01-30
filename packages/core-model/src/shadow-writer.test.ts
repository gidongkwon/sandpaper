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
});
