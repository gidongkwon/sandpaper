import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlugins } from "./use-plugins";

describe("createPlugins", () => {
  beforeEach(() => {
    localStorage.clear();
  });

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

  it("loads plugin settings from schema defaults and stored values", async () => {
    const invoke = vi.fn(async (command: string, payload?: Record<string, unknown>) => {
      if (command === "list_plugins_command") {
        return [
          {
            id: "alpha",
            name: "Alpha",
            version: "0.1.0",
            description: null,
            permissions: [],
            enabled: true,
            path: "/tmp/alpha",
            granted_permissions: [],
            missing_permissions: [],
            settings_schema: {
              type: "object",
              properties: {
                units: { type: "string", default: "c" }
              }
            }
          }
        ];
      }
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
      if (command === "get_plugin_settings_command") {
        if (payload?.pluginId === "alpha" || payload?.plugin_id === "alpha") {
          return { units: "f" };
        }
        return null;
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

    await api.loadPlugins();

    expect(api.pluginSettings().alpha.units).toBe("f");
    expect(invoke).toHaveBeenCalledWith("get_plugin_settings_command", {
      pluginId: "alpha",
      plugin_id: "alpha"
    });

    dispose?.();
  });

  it("updates a plugin and reloads the list", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "update_plugin_command") return null;
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

    await api.updatePlugin("alpha");

    expect(invoke).toHaveBeenCalledWith("update_plugin_command", {
      pluginId: "alpha",
      plugin_id: "alpha"
    });
    expect(invoke).toHaveBeenCalledWith("list_plugins_command");
    expect(invoke).toHaveBeenCalledWith("load_plugins_command");

    dispose?.();
  });

  it("removes a plugin and reloads the list", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "remove_plugin_command") return null;
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

    await api.removePlugin("alpha");

    expect(invoke).toHaveBeenCalledWith("remove_plugin_command", {
      pluginId: "alpha",
      plugin_id: "alpha"
    });
    expect(invoke).toHaveBeenCalledWith("list_plugins_command");
    expect(invoke).toHaveBeenCalledWith("load_plugins_command");

    dispose?.();
  });
});
