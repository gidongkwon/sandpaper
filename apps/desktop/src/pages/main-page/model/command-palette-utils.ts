import type { PluginCommand } from "../../../entities/plugin/model/plugin-types";
import type { Mode } from "../../../shared/model/mode";

export type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  action: () => void | Promise<void>;
};

type PaletteActions = {
  openSettings: () => void;
  switchToEditor: () => void;
  switchToCapture: () => void;
  switchToReview: () => void;
  focusSearch: () => void;
  focusEditor: () => void;
  newPage: () => void;
  renamePage: () => void;
  toggleBacklinks: () => void;
  syncNow: () => void;
  runPluginCommand: (command: PluginCommand) => void;
};

type BuildPaletteArgs = {
  mode: Mode;
  sidebarOpen: boolean;
  backlinksOpen: boolean;
  isTauri: boolean;
  syncConnected: boolean;
  pluginCommands: PluginCommand[];
  actions: PaletteActions;
};

export const buildPaletteCommands = (args: BuildPaletteArgs) => {
  const items: CommandPaletteItem[] = [
    {
      id: "open-settings",
      label: "Open settings",
      action: args.actions.openSettings
    }
  ];

  if (args.mode !== "editor") {
    items.push({
      id: "switch-editor",
      label: "Switch to editor",
      action: args.actions.switchToEditor
    });
  }
  if (args.mode !== "quick-capture") {
    items.push({
      id: "switch-capture",
      label: "Switch to quick capture",
      action: args.actions.switchToCapture
    });
  }
  if (args.mode !== "review") {
    items.push({
      id: "switch-review",
      label: "Switch to review",
      action: args.actions.switchToReview
    });
  }
  if (args.mode === "editor") {
    items.push(
      {
        id: "focus-search",
        label: "Focus search",
        action: args.actions.focusSearch
      },
      {
        id: "focus-editor",
        label: "Focus editor",
        action: args.actions.focusEditor
      },
      {
        id: "new-page",
        label: "Create new page",
        action: args.actions.newPage
      },
      {
        id: "rename-page",
        label: "Rename current page",
        action: args.actions.renamePage
      },
      {
        id: "toggle-backlinks",
        label: args.backlinksOpen ? "Hide backlinks panel" : "Show backlinks panel",
        action: args.actions.toggleBacklinks
      }
    );
  }

  if (args.isTauri && args.syncConnected) {
    items.push({
      id: "sync-now",
      label: "Sync now",
      action: args.actions.syncNow
    });
  }

  for (const command of args.pluginCommands) {
    items.push({
      id: `plugin:${command.id}`,
      label: command.title,
      hint: `Plugin · ${command.plugin_id}`,
      action: () => args.actions.runPluginCommand(command)
    });
  }

  return items;
};

export const filterPaletteCommands = (
  commands: CommandPaletteItem[],
  query: string
) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) => {
    const label = command.label.toLowerCase();
    const hint = command.hint?.toLowerCase() ?? "";
    return label.includes(normalized) || hint.includes(normalized);
  });
};

export const nextPaletteIndex = (
  current: number,
  delta: number,
  length: number
) => {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
};
