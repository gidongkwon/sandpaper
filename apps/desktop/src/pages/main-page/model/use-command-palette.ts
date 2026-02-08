import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Setter
} from "solid-js";
import type { PluginCommand } from "../../../entities/plugin/model/plugin-types";
import type { Mode } from "../../../shared/model/mode";
import {
  buildPaletteCommands,
  filterPaletteCommands,
  nextPaletteIndex,
  type CommandPaletteItem
} from "./command-palette-utils";

type CommandPaletteDeps = {
  mode: Accessor<Mode>;
  setMode: Setter<Mode>;
  sidebarOpen: Accessor<boolean>;
  setSidebarOpen: Setter<boolean>;
  backlinksOpen: Accessor<boolean>;
  setBacklinksOpen: Setter<boolean>;
  getSearchInput: () => HTMLInputElement | undefined;
  focusEditorSection: () => void;
  openNewPageDialog: () => void;
  createPageWithAllBlockTypes: () => void | Promise<void>;
  openRenamePageDialog: () => void;
  setSettingsOpen: (open: boolean) => void;
  syncConnected: Accessor<boolean>;
  syncNow: () => void | Promise<void>;
  pluginCommands: Accessor<PluginCommand[]>;
  runPluginCommand: (command: PluginCommand) => void | Promise<void>;
  isTauri: () => boolean;
};

export const createCommandPalette = (deps: CommandPaletteDeps) => {
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteQuery, setPaletteQuery] = createSignal("");
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  let paletteInputRef: HTMLInputElement | undefined;

  const openCommandPalette = () => {
    setPaletteOpen(true);
    setPaletteQuery("");
    setPaletteIndex(0);
  };

  const closeCommandPalette = () => {
    setPaletteOpen(false);
    setPaletteQuery("");
    setPaletteIndex(0);
  };

  const paletteCommands = createMemo<CommandPaletteItem[]>(() =>
    buildPaletteCommands({
      mode: deps.mode(),
      sidebarOpen: deps.sidebarOpen(),
      backlinksOpen: deps.backlinksOpen(),
      isTauri: deps.isTauri(),
      syncConnected: deps.syncConnected(),
      pluginCommands: deps.pluginCommands(),
      actions: {
        openSettings: () => deps.setSettingsOpen(true),
        switchToEditor: () => deps.setMode("editor"),
        switchToCapture: () => deps.setMode("quick-capture"),
        switchToReview: () => deps.setMode("review"),
        focusSearch: () => {
          if (!deps.sidebarOpen()) {
            deps.setSidebarOpen(true);
          }
          requestAnimationFrame(() => {
            deps.getSearchInput()?.focus();
          });
        },
        focusEditor: deps.focusEditorSection,
        newPage: deps.openNewPageDialog,
        newPageWithAllBlockTypes: () => void deps.createPageWithAllBlockTypes(),
        renamePage: deps.openRenamePageDialog,
        toggleBacklinks: () => deps.setBacklinksOpen((prev) => !prev),
        syncNow: () => void deps.syncNow(),
        runPluginCommand: (command) => void deps.runPluginCommand(command)
      }
    })
  );

  const filteredPaletteCommands = createMemo(() =>
    filterPaletteCommands(paletteCommands(), paletteQuery())
  );

  const runPaletteCommand = async (command?: CommandPaletteItem) => {
    if (!command) return;
    closeCommandPalette();
    try {
      await command.action();
    } catch (error) {
      console.error("Command palette action failed", error);
    }
  };

  const movePaletteIndex = (delta: number) => {
    const commands = filteredPaletteCommands();
    if (commands.length === 0) return;
    setPaletteIndex((current) =>
      nextPaletteIndex(current, delta, commands.length)
    );
  };

  const registerPaletteInput = (el: HTMLInputElement) => {
    paletteInputRef = el;
    if (paletteOpen()) {
      queueMicrotask(() => el.focus());
    }
  };

  createEffect(() => {
    paletteQuery();
    setPaletteIndex(0);
  });

  createEffect(() => {
    const commands = filteredPaletteCommands();
    if (commands.length === 0) {
      setPaletteIndex(0);
      return;
    }
    if (paletteIndex() >= commands.length) {
      setPaletteIndex(commands.length - 1);
    }
  });

  createEffect(() => {
    if (!paletteOpen()) return;
    requestAnimationFrame(() => {
      paletteInputRef?.focus();
      paletteInputRef?.select();
    });
  });

  onMount(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleGlobalKeydown);
    });
  });

  return {
    paletteOpen,
    paletteQuery,
    setPaletteQuery,
    paletteIndex,
    setPaletteIndex,
    filteredPaletteCommands,
    openCommandPalette,
    closeCommandPalette,
    movePaletteIndex,
    runPaletteCommand,
    registerPaletteInput
  };
};
