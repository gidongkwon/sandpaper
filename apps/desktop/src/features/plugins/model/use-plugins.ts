import { createSignal } from "solid-js";
import type {
  PermissionPrompt,
  PluginInstallStatus,
  PluginPermissionInfo,
  PluginRuntimeStatus
} from "../../../entities/plugin/model/plugin-types";

export type PluginDependencies = {
  isTauri: () => boolean;
  invoke: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
  onRuntimeError?: (message: string) => void;
};

const fallbackPlugins: PluginPermissionInfo[] = [
  {
    id: "local-calendar",
    name: "Local Calendar",
    version: "0.1.0",
    description: "Daily agenda panel",
    permissions: ["fs", "network", "data.write", "ui"],
    enabled: true,
    path: "/plugins/local-calendar",
    granted_permissions: ["fs", "data.write", "ui", "clipboard"],
    missing_permissions: ["network"]
  },
  {
    id: "focus-mode",
    name: "Focus Mode",
    version: "0.2.0",
    description: "Minimal editor layout",
    permissions: ["ui"],
    enabled: true,
    path: "/plugins/focus-mode",
    granted_permissions: [],
    missing_permissions: ["ui"]
  },
  {
    id: "insight-lens",
    name: "Insight Lens",
    version: "0.1.0",
    description: "Context-aware capture helper",
    permissions: ["data.write"],
    enabled: true,
    path: "/plugins/insight-lens",
    granted_permissions: [],
    missing_permissions: ["data.write"]
  }
];

const fallbackPluginStatus: PluginRuntimeStatus = {
  loaded: ["local-calendar", "focus-mode", "insight-lens"],
  blocked: [],
  commands: [
    {
      plugin_id: "local-calendar",
      id: "local-calendar.open",
      title: "Open local-calendar",
      description: "Open local-calendar panel"
    },
    {
      plugin_id: "insight-lens",
      id: "insight-lens.capture",
      title: "Capture highlight",
      description: "Append a capture block"
    }
  ],
  panels: [
    {
      plugin_id: "local-calendar",
      id: "local-calendar.panel",
      title: "Calendar panel",
      location: "sidebar"
    },
    {
      plugin_id: "focus-mode",
      id: "focus-mode.panel",
      title: "Focus panel",
      location: "sidebar"
    }
  ],
  toolbar_actions: [
    {
      plugin_id: "local-calendar",
      id: "local-calendar.toolbar",
      title: "Today focus",
      tooltip: "Jump to today"
    }
  ],
  renderers: [
    {
      plugin_id: "local-calendar",
      id: "local-calendar.renderer.code",
      title: "Code block renderer",
      kind: "code"
    },
    {
      plugin_id: "local-calendar",
      id: "local-calendar.renderer.diagram",
      title: "Diagram renderer",
      kind: "diagram"
    }
  ]
};

export const createPlugins = (deps: PluginDependencies) => {
  const [plugins, setPlugins] = createSignal<PluginPermissionInfo[]>([]);
  const [pluginStatus, setPluginStatus] =
    createSignal<PluginRuntimeStatus | null>(null);
  const [pluginError, setPluginError] = createSignal<string | null>(null);
  const [pluginBusy, setPluginBusy] = createSignal(false);
  const [permissionPrompt, setPermissionPrompt] =
    createSignal<PermissionPrompt | null>(null);
  const [installPath, setInstallPath] = createSignal("");
  const [installStatus, setInstallStatus] =
    createSignal<PluginInstallStatus | null>(null);
  const [installing, setInstalling] = createSignal(false);

  const findPlugin = (pluginId: string) =>
    plugins().find((plugin) => plugin.id === pluginId) ?? null;

  const hasPermission = (pluginId: string, permission: string) => {
    const plugin = findPlugin(pluginId);
    if (!plugin) return false;
    return plugin.granted_permissions.includes(permission);
  };

  const requestGrantPermission = (
    plugin: PluginPermissionInfo,
    permission: string
  ) => {
    setPermissionPrompt({
      pluginId: plugin.id,
      pluginName: plugin.name,
      permission
    });
  };

  const loadPluginRuntime = async () => {
    if (!deps.isTauri()) {
      setPluginStatus(fallbackPluginStatus);
      return;
    }

    setPluginError(null);
    setPluginBusy(true);
    try {
      const status = (await deps.invoke(
        "load_plugins_command"
      )) as PluginRuntimeStatus;
      setPluginStatus(status);
    } catch (error) {
      console.error("Failed to load plugins", error);
      const message =
        error instanceof Error ? error.message : "Failed to load plugins.";
      setPluginError(message);
      deps.onRuntimeError?.(message);
    } finally {
      setPluginBusy(false);
    }
  };

  const loadPlugins = async () => {
    if (!deps.isTauri()) {
      setPlugins(fallbackPlugins);
      setPluginStatus(fallbackPluginStatus);
      return;
    }

    setPluginError(null);
    try {
      const remote = (await deps.invoke(
        "list_plugins_command"
      )) as PluginPermissionInfo[];
      setPlugins(remote);
    } catch (error) {
      console.error("Failed to load plugins", error);
      const message =
        error instanceof Error ? error.message : "Failed to load plugins.";
      setPluginError(message);
      deps.onRuntimeError?.(message);
    }

    await loadPluginRuntime();
  };

  const grantPermission = async () => {
    const prompt = permissionPrompt();
    if (!prompt) return;
    setPluginBusy(true);
    try {
      await deps.invoke("grant_plugin_permission", {
        pluginId: prompt.pluginId,
        plugin_id: prompt.pluginId,
        permission: prompt.permission
      });
      await loadPlugins();
    } catch (error) {
      console.error("Failed to grant plugin permission", error);
    } finally {
      setPluginBusy(false);
      setPermissionPrompt(null);
    }
  };

  const denyPermission = () => {
    setPermissionPrompt(null);
  };

  const clearInstallStatus = () => {
    setInstallStatus(null);
  };

  const installPlugin = async () => {
    const path = installPath().trim();
    if (!path) {
      setInstallStatus({
        state: "error",
        message: "Select a plugin folder to install."
      });
      return;
    }
    if (!deps.isTauri()) {
      setInstallStatus({
        state: "error",
        message: "Plugin installs require the desktop app."
      });
      return;
    }
    setInstalling(true);
    setInstallStatus(null);
    try {
      await deps.invoke("install_plugin_command", { path });
      setInstallStatus({
        state: "success",
        message: "Plugin installed."
      });
      setInstallPath("");
      await loadPlugins();
    } catch (error) {
      console.error("Failed to install plugin", error);
      const message =
        error instanceof Error ? error.message : "Failed to install plugin.";
      setInstallStatus({ state: "error", message });
    } finally {
      setInstalling(false);
    }
  };

  return {
    plugins,
    pluginStatus,
    pluginError,
    pluginBusy,
    permissionPrompt,
    installPath,
    installStatus,
    installing,
    setPluginError,
    loadPlugins,
    loadPluginRuntime,
    requestGrantPermission,
    grantPermission,
    denyPermission,
    clearInstallStatus,
    installPlugin,
    setInstallPath,
    findPlugin,
    hasPermission
  };
};
