export type PluginRendererDefinition = {
  id: string;
  title: string;
  kind: string;
  languages?: string[];
};

export type PluginCommandDefinition = {
  id: string;
  title: string;
  description?: string;
};

export type PluginPanelDefinition = {
  id: string;
  title: string;
  location?: string | null;
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
  summary?: string;
  next_text?: string;
  status?: string;
  message?: string;
  body?: PluginBlockBody | null;
  controls?: PluginBlockControl[];
};

export type PluginBlockContext = {
  block: {
    uid: string;
    text: string;
  };
  config: Record<string, string>;
  summary?: string;
  settings?: Record<string, unknown>;
  action?: {
    id: string;
    value?: unknown;
  };
  network: {
    fetch: (
      url: string,
      options?: {
        method?: string;
        body?: string;
      }
    ) => { ok: boolean; status: number; text: string };
  };
};

export type PluginRendererHandlers = {
  render: (ctx: PluginBlockContext) => PluginBlockView | Promise<PluginBlockView>;
  onAction?: (ctx: PluginBlockContext) => PluginBlockView | Promise<PluginBlockView>;
};

export type PluginApi = {
  registerRenderer: (
    def: PluginRendererDefinition,
    handlers: PluginRendererHandlers
  ) => void;
  registerCommand: (
    def: PluginCommandDefinition,
    handler?: () => void | Promise<void>
  ) => void;
  registerPanel: (
    def: PluginPanelDefinition,
    handler?: () => void | Promise<void>
  ) => void;
};

export type PluginRegister = (api: PluginApi) => void;

export const definePlugin = (register: PluginRegister) => register;
