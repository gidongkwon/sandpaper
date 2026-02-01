import type { Accessor } from "solid-js";
import { produce, type SetStoreFunction } from "solid-js/store";
import type { Block } from "../../../entities/block/model/block-types";
import type {
  PluginCommand,
  PluginPanel,
  PluginPermissionInfo
} from "../../../entities/plugin/model/plugin-types";

type InvokeFn = typeof import("@tauri-apps/api/core").invoke;

type PluginActionsDeps = {
  isTauri: () => boolean;
  invoke: InvokeFn;
  hasPermission: (pluginId: string, permission: string) => boolean;
  findPlugin: (id: string) => PluginPermissionInfo | null;
  requestGrantPermission: (plugin: PluginPermissionInfo, permission: string) => void;
  setActivePanel: (panel: PluginPanel | null) => void;
  setCommandStatus: (value: string | null) => void;
  setPluginError: (message: string) => void;
  blocks: Accessor<Block[]>;
  setBlocks: SetStoreFunction<Block[]>;
  scheduleSave: () => void;
  activePageUid: Accessor<string>;
  resolvePageUid: (value: string) => string;
  makeRandomId: () => string;
  makeBlock: (uid: string, text: string, indent: number) => Block;
};

export const createPluginActions = (deps: PluginActionsDeps) => {
  const openPanel = (panel: PluginPanel) => {
    if (!deps.hasPermission(panel.plugin_id, "ui")) {
      const plugin = deps.findPlugin(panel.plugin_id);
      if (plugin) deps.requestGrantPermission(plugin, "ui");
      return;
    }
    deps.setActivePanel(panel);
  };

  const runPluginCommand = async (command: PluginCommand) => {
    if (!deps.hasPermission(command.plugin_id, "data.write")) {
      const plugin = deps.findPlugin(command.plugin_id);
      if (plugin) deps.requestGrantPermission(plugin, "data.write");
      return;
    }

    const text = `Plugin action: ${command.title}`;
    const newBlock = deps.makeBlock(deps.makeRandomId(), text, 0);
    const nextBlocks = [newBlock, ...deps.blocks()];
    deps.setBlocks(
      produce((draft) => {
        draft.unshift(newBlock);
      })
    );
    deps.scheduleSave();
    deps.setCommandStatus(`Ran ${command.id}`);

    if (!deps.isTauri()) return;

    try {
      const pageUid = deps.resolvePageUid(deps.activePageUid());
      await deps.invoke("plugin_write_page", {
        pluginId: command.plugin_id,
        plugin_id: command.plugin_id,
        pageUid,
        page_uid: pageUid,
        blocks: nextBlocks.map((block) => ({
          uid: block.id,
          text: block.text,
          indent: block.indent
        }))
      });
    } catch (error) {
      console.error("Plugin command failed", error);
      deps.setPluginError(
        error instanceof Error ? error.message : "Plugin command failed."
      );
    }
  };

  return {
    openPanel,
    runPluginCommand
  };
};
