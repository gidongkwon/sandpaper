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
  languages?: string[];
};

export type PluginBlockControl =
  | {
      id: string;
      type: "button";
      label: string;
    }
  | {
      id: string;
      type: "select";
      label: string;
      options: Array<{ label: string; value: string }>;
      value?: string | null;
    }
  | {
      id: string;
      type: "clipboard";
      label: string;
      text: string;
    };

export type PluginBlockBody =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "list";
      items: string[];
    }
  | {
      kind: "stats";
      items: Array<{ label: string; value: string }>;
    };

export type PluginBlockView = {
  plugin_id: string;
  renderer_id: string;
  block_uid: string;
  summary?: string | null;
  next_text?: string | null;
  status?: string | null;
  message?: string | null;
  body?: PluginBlockBody | null;
  controls?: PluginBlockControl[];
};

export type PermissionPrompt = {
  pluginId: string;
  pluginName: string;
  permission: string;
};
