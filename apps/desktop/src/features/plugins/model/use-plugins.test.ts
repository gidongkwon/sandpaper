import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createPlugins } from "./use-plugins";

describe("createPlugins", () => {
  it("loads fallback plugins and exposes permissions", async () => {
    const invoke = vi.fn();
    let dispose: (() => void) | undefined;
    let api: ReturnType<typeof createPlugins> | undefined;

    createRoot((cleanup) => {
      dispose = cleanup;
      api = createPlugins({
        isTauri: () => false,
        invoke
      });
    });

    if (!api) throw new Error("Plugins API not initialized");

    await api.loadPlugins();

    expect(api.plugins().length).toBeGreaterThan(0);
    const plugin = api.plugins()[0];
    api.requestGrantPermission(plugin, "network");

    expect(api.permissionPrompt()?.pluginId).toBe(plugin.id);
    expect(api.permissionPrompt()?.permission).toBe("network");
    expect(api.hasPermission("local-calendar", "fs")).toBe(true);

    dispose?.();
  });
});
