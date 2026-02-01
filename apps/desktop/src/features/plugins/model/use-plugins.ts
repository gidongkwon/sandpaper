import { createEffect, createSignal, onCleanup } from "solid-js";
import { applySettingsSchemaDefaults } from "../lib/plugin-settings";
import type {
  PermissionPrompt,
  PluginInstallStatus,
  PluginPermissionInfo,
  PluginRuntimeError,
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

type PluginSettingsStatus = {
  state: "idle" | "saving" | "success" | "error";
  message?: string;
};

const DEV_MODE_STORAGE_KEY = "sandpaper:plugin-dev-mode";

export const createPlugins = (deps: PluginDependencies) => {
  const [plugins, setPlugins] = createSignal<PluginPermissionInfo[]>([]);
  const [pluginStatus, setPluginStatus] =
    createSignal<PluginRuntimeStatus | null>(null);
  const [pluginError, setPluginErrorSignal] = createSignal<string | null>(null);
  const [pluginErrorDetails, setPluginErrorDetails] =
    createSignal<PluginRuntimeError | null>(null);
  const [pluginBusy, setPluginBusy] = createSignal(false);
  const [permissionPrompt, setPermissionPrompt] =
    createSignal<PermissionPrompt | null>(null);
  const [installPath, setInstallPath] = createSignal("");
  const [installStatus, setInstallStatus] =
    createSignal<PluginInstallStatus | null>(null);
  const [installing, setInstalling] = createSignal(false);
  const [pluginSettings, setPluginSettings] = createSignal<
    Record<string, Record<string, unknown>>
  >({});
  const [pluginSettingsDirty, setPluginSettingsDirty] = createSignal<
    Record<string, boolean>
  >({});
  const [pluginSettingsStatus, setPluginSettingsStatus] = createSignal<
    Record<string, PluginSettingsStatus | null>
  >({});
  const initialDevMode =
    typeof window === "undefined"
      ? false
      : localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
  const [pluginDevMode, setPluginDevMode] = createSignal(initialDevMode);

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

  const updatePluginSettingsStatus = (
    pluginId: string,
    status: PluginSettingsStatus | null
  ) => {
    setPluginSettingsStatus((current) => ({
      ...current,
      [pluginId]: status
    }));
  };

  const markPluginSettingsDirty = (pluginId: string, dirty: boolean) => {
    setPluginSettingsDirty((current) => ({
      ...current,
      [pluginId]: dirty
    }));
  };

  const loadSettingsForPlugins = async (nextPlugins: PluginPermissionInfo[]) => {
    if (!Array.isArray(nextPlugins) || nextPlugins.length === 0) return;
    const nextSettings: Record<string, Record<string, unknown>> = {};
    for (const plugin of nextPlugins) {
      const schema = plugin.settings_schema;
      if (!schema) continue;
      if (!deps.isTauri()) {
        nextSettings[plugin.id] = applySettingsSchemaDefaults(schema, {});
        markPluginSettingsDirty(plugin.id, false);
        updatePluginSettingsStatus(plugin.id, { state: "idle" });
        continue;
      }
      try {
        const stored = (await deps.invoke("get_plugin_settings_command", {
          pluginId: plugin.id,
          plugin_id: plugin.id
        })) as Record<string, unknown> | null;
        nextSettings[plugin.id] = applySettingsSchemaDefaults(schema, stored ?? {});
        markPluginSettingsDirty(plugin.id, false);
        updatePluginSettingsStatus(plugin.id, { state: "idle" });
      } catch (error) {
        console.error("Failed to load plugin settings", error);
        updatePluginSettingsStatus(plugin.id, {
          state: "error",
          message: "Failed to load settings."
        });
      }
    }
    if (Object.keys(nextSettings).length > 0) {
      setPluginSettings((current) => ({
        ...current,
        ...nextSettings
      }));
    }
  };

  const setPluginError = (message: string | null) => {
    setPluginErrorSignal(message);
    if (!message) {
      setPluginErrorDetails(null);
    }
  };

  const loadPluginRuntime = async () => {
    if (!deps.isTauri()) {
      setPluginStatus(fallbackPluginStatus);
      return;
    }

    setPluginError(null);
    setPluginErrorDetails(null);
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
      try {
        const details = (await deps.invoke(
          "get_plugin_runtime_error_command"
        )) as PluginRuntimeError | null;
        setPluginErrorDetails(details);
      } catch (detailError) {
        console.warn("Failed to load plugin error details", detailError);
        setPluginErrorDetails(null);
      }
      deps.onRuntimeError?.(message);
    } finally {
      setPluginBusy(false);
    }
  };

  const loadPlugins = async () => {
    if (!deps.isTauri()) {
      setPlugins(fallbackPlugins);
      setPluginStatus(fallbackPluginStatus);
      await loadSettingsForPlugins(fallbackPlugins);
      return;
    }

    setPluginError(null);
    try {
      const remote = (await deps.invoke(
        "list_plugins_command"
      )) as PluginPermissionInfo[] | null;
      const normalized = Array.isArray(remote) ? remote : [];
      setPlugins(normalized);
      await loadSettingsForPlugins(normalized);
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

  const updatePluginSetting = (
    pluginId: string,
    key: string,
    value: unknown
  ) => {
    setPluginSettings((current) => ({
      ...current,
      [pluginId]: {
        ...(current[pluginId] ?? {}),
        [key]: value
      }
    }));
    markPluginSettingsDirty(pluginId, true);
  };

  const resetPluginSettings = (pluginId: string) => {
    const plugin = findPlugin(pluginId);
    if (!plugin?.settings_schema) return;
    const nextValues = applySettingsSchemaDefaults(plugin.settings_schema, {});
    setPluginSettings((current) => ({
      ...current,
      [pluginId]: nextValues
    }));
    markPluginSettingsDirty(pluginId, true);
    updatePluginSettingsStatus(pluginId, { state: "idle" });
  };

  const savePluginSettings = async (pluginId: string) => {
    if (!deps.isTauri()) {
      updatePluginSettingsStatus(pluginId, {
        state: "error",
        message: "Plugin settings require the desktop app."
      });
      return;
    }
    updatePluginSettingsStatus(pluginId, { state: "saving" });
    try {
      const settings = pluginSettings()[pluginId] ?? {};
      await deps.invoke("set_plugin_settings_command", {
        pluginId,
        plugin_id: pluginId,
        settings
      });
      markPluginSettingsDirty(pluginId, false);
      updatePluginSettingsStatus(pluginId, { state: "success", message: "Saved." });
    } catch (error) {
      console.error("Failed to save plugin settings", error);
      updatePluginSettingsStatus(pluginId, {
        state: "error",
        message: "Failed to save settings."
      });
    }
  };

  createEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(DEV_MODE_STORAGE_KEY, pluginDevMode() ? "1" : "0");
  });

  createEffect(() => {
    if (!deps.isTauri()) return;
    if (!pluginDevMode()) return;
    void loadPlugins();
    const interval = setInterval(() => {
      if (!pluginBusy()) {
        void loadPlugins();
      }
    }, 2000);
    onCleanup(() => clearInterval(interval));
  });

  return {
    plugins,
    pluginStatus,
    pluginError,
    pluginErrorDetails,
    pluginBusy,
    permissionPrompt,
    installPath,
    installStatus,
    installing,
    pluginSettings,
    pluginSettingsDirty,
    pluginSettingsStatus,
    pluginDevMode,
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
    hasPermission,
    updatePluginSetting,
    resetPluginSettings,
    savePluginSettings,
    setPluginDevMode
  };
};
