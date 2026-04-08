import { describe, expect, it } from "vitest";
import type { PluginCommand } from "../../../entities/plugin/model/plugin-types";
import {
  buildCreatePageItem,
  buildPaletteCommands,
  commitRecentPageHistory,
  filterPaletteCommands,
  nextPaletteIndex,
  parsePaletteQuery,
  shouldPrioritizeCommands
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
  it("builds command items based on app state", () => {
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
    expect(commands.every((command) => command.kind === "command")).toBe(true);
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

  it("parses command-only prefix queries", () => {
    expect(parsePaletteQuery(">rename")).toEqual({
      commandOnly: true,
      term: "rename"
    });
    expect(parsePaletteQuery("  >  settings  ")).toEqual({
      commandOnly: true,
      term: "settings"
    });
    expect(parsePaletteQuery("home")).toEqual({
      commandOnly: false,
      term: "home"
    });
  });

  it("filters and prioritizes commands by query strength", () => {
    const commands = [
      { kind: "command" as const, id: "a", label: "Open settings", action: noop },
      { kind: "command" as const, id: "b", label: "Sync now", hint: "Sync", action: noop }
    ];
    expect(filterPaletteCommands(commands, "settings")).toHaveLength(1);
    expect(filterPaletteCommands(commands, "sync")).toHaveLength(1);
    expect(filterPaletteCommands(commands, "")).toHaveLength(2);
    expect(shouldPrioritizeCommands(commands, "sync")).toBe(true);
    expect(shouldPrioritizeCommands(commands, "note")).toBe(false);
  });

  it("tracks recent page history with de-duplication and cap", () => {
    const history = ["beta", "gamma", "delta", "epsilon", "zeta", "eta"];
    expect(commitRecentPageHistory(history, "beta")).toEqual([
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta"
    ]);
    expect(commitRecentPageHistory(history, "alpha")).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta"
    ]);
  });

  it("builds create-page fallback items", () => {
    expect(buildCreatePageItem("Draft page", noop)).toMatchObject({
      kind: "create-page",
      query: "Draft page",
      label: 'Create page "Draft page"'
    });
  });

  it("wraps palette index", () => {
    expect(nextPaletteIndex(2, 1, 3)).toBe(0);
    expect(nextPaletteIndex(0, -1, 3)).toBe(2);
    expect(nextPaletteIndex(1, 1, 3)).toBe(2);
  });
});
