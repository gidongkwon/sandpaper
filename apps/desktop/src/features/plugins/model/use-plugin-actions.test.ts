import { createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "../../../entities/block/model/block-types";
import type { PluginCommand, PluginPanel } from "../../../entities/plugin/model/plugin-types";
import { createPluginActions } from "./use-plugin-actions";

type PluginActionDeps = Parameters<typeof createPluginActions>[0];

describe("createPluginActions", () => {
  const buildDeps = (overrides: Partial<PluginActionDeps> = {}) => {
    const [blocks, setBlocks] = createStore<Block[]>([]);
    const [activePageUid] = createSignal("inbox");

    const deps: PluginActionDeps = {
      isTauri: () => false,
      invoke: vi.fn().mockResolvedValue(null),
      hasPermission: vi.fn(() => true),
      findPlugin: vi.fn(),
      requestGrantPermission: vi.fn(),
      setActivePanel: vi.fn(),
      setCommandStatus: vi.fn(),
      setPluginError: vi.fn(),
      blocks: () => blocks,
      setBlocks,
      scheduleSave: vi.fn(),
      activePageUid,
      resolvePageUid: (value) => value,
      makeRandomId: () => "block-1",
      makeBlock: (id, text, indent) => ({ id, text, indent }),
      ...overrides
    };

    return { deps, blocks };
  };

  it("requests permission before opening a panel", () => {
    createRoot((dispose) => {
      const panel: PluginPanel = {
        plugin_id: "plug-a",
        id: "panel-1",
        title: "Panel"
      };
      const { deps } = buildDeps({
        hasPermission: vi.fn(() => false),
        findPlugin: vi.fn((id: string) => ({
          id,
          name: "Plugin A",
          version: "1",
          permissions: [],
          enabled: true,
          path: "",
          granted_permissions: [],
          missing_permissions: []
        })) as PluginActionDeps["findPlugin"]
      });
      const actions = createPluginActions(deps);

      actions.openPanel(panel);

      expect(deps.requestGrantPermission).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plug-a" }),
        "ui"
      );
      expect(deps.setActivePanel).not.toHaveBeenCalled();

      dispose();
    });
  });

  it("opens a panel when permission exists", () => {
    createRoot((dispose) => {
      const panel: PluginPanel = {
        plugin_id: "plug-a",
        id: "panel-1",
        title: "Panel"
      };
      const { deps } = buildDeps({ hasPermission: vi.fn(() => true) });
      const actions = createPluginActions(deps);

      actions.openPanel(panel);

      expect(deps.setActivePanel).toHaveBeenCalledWith(panel);
      expect(deps.requestGrantPermission).not.toHaveBeenCalled();

      dispose();
    });
  });

  it("runs a plugin command in browser mode", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const command: PluginCommand = {
          plugin_id: "plug-a",
          id: "cmd-1",
          title: "Do thing"
        };
        const { deps, blocks } = buildDeps({
          isTauri: () => false,
          makeRandomId: () => "block-1"
        });
        const actions = createPluginActions(deps);

        actions
          .runPluginCommand(command)
          .then(() => {
            expect(blocks[0]).toEqual({
              id: "block-1",
              text: "Plugin action: Do thing",
              indent: 0
            });
            expect(deps.scheduleSave).toHaveBeenCalledTimes(1);
            expect(deps.setCommandStatus).toHaveBeenCalledWith("Ran cmd-1");
            expect(deps.invoke).not.toHaveBeenCalled();
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            throw error;
          });
      });
    });
  });

  it("invokes plugin write in Tauri mode", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const command: PluginCommand = {
          plugin_id: "plug-a",
          id: "cmd-1",
          title: "Do thing"
        };
        const invoke = vi.fn().mockResolvedValue(null);
        const { deps } = buildDeps({
          isTauri: () => true,
          invoke,
          makeRandomId: () => "block-1"
        });
        const actions = createPluginActions(deps);

        actions
          .runPluginCommand(command)
          .then(() => {
            expect(invoke).toHaveBeenCalledWith(
              "plugin_write_page",
              expect.objectContaining({
                pluginId: "plug-a",
                plugin_id: "plug-a",
                pageUid: "inbox",
                page_uid: "inbox",
                blocks: [
                  {
                    uid: "block-1",
                    text: "Plugin action: Do thing",
                    indent: 0
                  }
                ]
              })
            );
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            throw error;
          });
      });
    });
  });

  it("reports errors when plugin command fails", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const command: PluginCommand = {
          plugin_id: "plug-a",
          id: "cmd-1",
          title: "Do thing"
        };
        const invoke = vi.fn().mockRejectedValue(new Error("boom"));
        const { deps } = buildDeps({
          isTauri: () => true,
          invoke,
          makeRandomId: () => "block-1"
        });
        const actions = createPluginActions(deps);

        actions
          .runPluginCommand(command)
          .then(() => {
            expect(deps.setPluginError).toHaveBeenCalledWith("boom");
            dispose();
            resolve();
          })
          .catch((error) => {
            dispose();
            throw error;
          });
      });
    });
  });
});
