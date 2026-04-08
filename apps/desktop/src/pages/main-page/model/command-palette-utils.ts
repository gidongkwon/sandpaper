import type { PluginCommand } from "../../../entities/plugin/model/plugin-types";
import type { Mode } from "../../../shared/model/mode";

export type CommandPaletteCommandItem = {
  kind: "command";
  id: string;
  label: string;
  hint?: string;
  action: () => void | Promise<void>;
};

export type CommandPaletteNoteItem = {
  kind: "note";
  id: string;
  title: string;
  snippet?: string;
  breadcrumb?: string | null;
  pageUid: string;
  blockUid?: string | null;
  action: () => void | Promise<void>;
};

export type CommandPaletteCreatePageItem = {
  kind: "create-page";
  id: string;
  label: string;
  query: string;
  action: () => void | Promise<void>;
};

export type CommandPaletteItem =
  | CommandPaletteCommandItem
  | CommandPaletteNoteItem
  | CommandPaletteCreatePageItem;

export type PaletteQuery = {
  commandOnly: boolean;
  term: string;
};

type PaletteActions = {
  openSettings: () => void;
  switchToEditor: () => void;
  switchToCapture: () => void;
  switchToReview: () => void;
  focusSearch: () => void;
  focusEditor: () => void;
  newPage: () => void;
  newPageWithAllBlockTypes: () => void;
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

const MAX_RECENT_PAGE_HISTORY = 12;

const scoreCommandMatch = (
  item: CommandPaletteCommandItem,
  normalized: string
) => {
  if (!normalized) return 0;
  const label = item.label.toLowerCase();
  const hint = item.hint?.toLowerCase() ?? "";
  if (label === normalized) return 400;
  if (label.startsWith(normalized)) return 250;
  if (label.includes(normalized)) return 180;
  if (hint.includes(normalized)) return 80;
  return 0;
};

export const parsePaletteQuery = (query: string): PaletteQuery => {
  const trimmedStart = query.trimStart();
  if (trimmedStart.startsWith(">")) {
    return {
      commandOnly: true,
      term: trimmedStart.slice(1).trim()
    };
  }

  return {
    commandOnly: false,
    term: query.trim()
  };
};

export const buildPaletteCommands = (args: BuildPaletteArgs) => {
  const items: CommandPaletteCommandItem[] = [
    {
      kind: "command",
      id: "open-settings",
      label: "Open settings",
      action: args.actions.openSettings
    }
  ];

  if (args.mode !== "editor") {
    items.push({
      kind: "command",
      id: "switch-editor",
      label: "Switch to editor",
      action: args.actions.switchToEditor
    });
  }
  if (args.mode !== "quick-capture") {
    items.push({
      kind: "command",
      id: "switch-capture",
      label: "Switch to quick capture",
      action: args.actions.switchToCapture
    });
  }
  if (args.mode !== "review") {
    items.push({
      kind: "command",
      id: "switch-review",
      label: "Switch to review",
      action: args.actions.switchToReview
    });
  }
  if (args.mode === "editor") {
    items.push(
      {
        kind: "command",
        id: "focus-search",
        label: "Focus search",
        action: args.actions.focusSearch
      },
      {
        kind: "command",
        id: "focus-editor",
        label: "Focus editor",
        action: args.actions.focusEditor
      },
      {
        kind: "command",
        id: "new-page",
        label: "Create new page",
        action: args.actions.newPage
      },
      {
        kind: "command",
        id: "new-page-all-block-types",
        label: "Create page with all block types",
        action: args.actions.newPageWithAllBlockTypes
      },
      {
        kind: "command",
        id: "rename-page",
        label: "Rename current page",
        action: args.actions.renamePage
      },
      {
        kind: "command",
        id: "toggle-backlinks",
        label: args.backlinksOpen ? "Hide backlinks panel" : "Show backlinks panel",
        action: args.actions.toggleBacklinks
      }
    );
  }

  if (args.isTauri && args.syncConnected) {
    items.push({
      kind: "command",
      id: "sync-now",
      label: "Sync now",
      action: args.actions.syncNow
    });
  }

  for (const command of args.pluginCommands) {
    items.push({
      kind: "command",
      id: `plugin:${command.id}`,
      label: command.title,
      hint: `Plugin · ${command.plugin_id}`,
      action: () => args.actions.runPluginCommand(command)
    });
  }

  return items;
};

export const filterPaletteCommands = (
  commands: CommandPaletteCommandItem[],
  query: string
) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;

  return commands
    .map((command) => ({
      command,
      score: scoreCommandMatch(command, normalized)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.command);
};

export const commitRecentPageHistory = (history: string[], pageUid: string) => {
  const trimmed = pageUid.trim();
  if (!trimmed) return history;
  return [
    trimmed,
    ...history.filter((entry) => entry !== trimmed)
  ].slice(0, MAX_RECENT_PAGE_HISTORY);
};

export const buildCreatePageItem = (
  query: string,
  action: () => void | Promise<void>
): CommandPaletteCreatePageItem => ({
  kind: "create-page",
  id: `create-page:${query.toLowerCase()}`,
  label: `Create page "${query}"`,
  query,
  action
});

export const shouldPrioritizeCommands = (
  commands: CommandPaletteCommandItem[],
  query: string
) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  return commands.some((command) => scoreCommandMatch(command, normalized) >= 250);
};

export const nextPaletteIndex = (
  current: number,
  delta: number,
  length: number
) => {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
};
