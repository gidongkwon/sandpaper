export type PluginPermissionInfo = {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  permissions: string[];
  enabled: boolean;
  path: string;
  granted_permissions: string[];
  missing_permissions: string[];
};

export type PluginBlockInfo = {
  id: string;
  reason: string;
  missing_permissions: string[];
};

export type PluginRuntimeStatus = {
  loaded: string[];
  blocked: string[];
  commands: PluginCommand[];
  panels: PluginPanel[];
  toolbar_actions: PluginToolbarAction[];
  renderers: PluginRenderer[];
};

export type PluginCommand = {
  plugin_id: string;
  id: string;
  title: string;
  description?: string;
};

export type PluginPanel = {
  plugin_id: string;
  id: string;
  title: string;
  location?: string | null;
};

export type PluginToolbarAction = {
  plugin_id: string;
  id: string;
  title: string;
  tooltip?: string | null;
};

export type PluginRenderer = {
  plugin_id: string;
  id: string;
  title: string;
  kind: string;
};

export type PermissionPrompt = {
  pluginId: string;
  pluginName: string;
  permission: string;
};
