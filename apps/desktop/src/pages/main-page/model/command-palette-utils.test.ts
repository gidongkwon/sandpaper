import { describe, expect, it } from "vitest";
import type { PluginCommand } from "../../../entities/plugin/model/plugin-types";
import {
  buildPaletteCommands,
  filterPaletteCommands,
  nextPaletteIndex
} from "./command-palette-utils";

const noop = () => undefined;

const buildActions = () => ({
  openSettings: noop,
  switchToEditor: noop,
  switchToCapture: noop,
  switchToReview: noop,
  focusSearch: noop,
  focusEditor: noop,
  newPage: noop,
  newPageWithAllBlockTypes: noop,
  renamePage: noop,
  toggleBacklinks: noop,
  syncNow: noop,
  runPluginCommand: noop
});

describe("command palette utils", () => {
  it("builds commands based on app state", () => {
    const pluginCommands: PluginCommand[] = [
      { id: "one", plugin_id: "plug", title: "One" }
    ];
    const commands = buildPaletteCommands({
      mode: "editor",
      sidebarOpen: true,
      backlinksOpen: false,
      isTauri: true,
      syncConnected: true,
      pluginCommands,
      actions: buildActions()
    });

    const ids = commands.map((command) => command.id);
    expect(ids).toContain("open-settings");
    expect(ids).toContain("new-page");
    expect(ids).toContain("new-page-all-block-types");
    expect(ids).toContain("rename-page");
    expect(ids).toContain("toggle-backlinks");
    expect(ids).toContain("sync-now");
    expect(ids).toContain("plugin:one");
  });

  it("adds mode switch commands when not in editor", () => {
    const commands = buildPaletteCommands({
      mode: "quick-capture",
      sidebarOpen: false,
      backlinksOpen: false,
      isTauri: false,
      syncConnected: false,
      pluginCommands: [],
      actions: buildActions()
    });

    const ids = commands.map((command) => command.id);
    expect(ids).toContain("switch-editor");
    expect(ids).toContain("switch-review");
    expect(ids).not.toContain("new-page");
  });

  it("filters commands by query", () => {
    const commands = [
      { id: "a", label: "Open settings", action: noop },
      { id: "b", label: "Sync now", hint: "Sync", action: noop }
    ];
    expect(filterPaletteCommands(commands, "settings")).toHaveLength(1);
    expect(filterPaletteCommands(commands, "sync")).toHaveLength(1);
    expect(filterPaletteCommands(commands, "")).toHaveLength(2);
  });

  it("wraps palette index", () => {
    expect(nextPaletteIndex(2, 1, 3)).toBe(0);
    expect(nextPaletteIndex(0, -1, 3)).toBe(2);
    expect(nextPaletteIndex(1, 1, 3)).toBe(2);
  });
});
