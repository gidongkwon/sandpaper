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

  it("installs a plugin and reloads status", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "install_plugin_command") return null;
      if (command === "list_plugins_command") return [];
      if (command === "load_plugins_command") {
        return {
          loaded: [],
          blocked: [],
          commands: [],
          panels: [],
          toolbar_actions: [],
          renderers: []
        };
      }
      throw new Error(`Unexpected command ${command}`);
    });
    let dispose: (() => void) | undefined;
    let api: ReturnType<typeof createPlugins> | undefined;

    createRoot((cleanup) => {
      dispose = cleanup;
      api = createPlugins({
        isTauri: () => true,
        invoke
      });
    });

    if (!api) throw new Error("Plugins API not initialized");

    api.setInstallPath("/Users/demo/hn-top");
    await api.installPlugin();

    expect(invoke).toHaveBeenCalledWith("install_plugin_command", {
      path: "/Users/demo/hn-top"
    });
    expect(invoke).toHaveBeenCalledWith("list_plugins_command");
    expect(invoke).toHaveBeenCalledWith("load_plugins_command");
    expect(api.installStatus()?.state).toBe("success");

    dispose?.();
  });
});
