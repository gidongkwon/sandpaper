import { For, Show, type Accessor } from "solid-js";
import type {
  PluginCommand,
  PluginPanel,
  PluginPermissionInfo,
  PluginRuntimeStatus
} from "../../entities/plugin/model/plugin-types";

type SettingsPluginsProps = {
  error: Accessor<string | null>;
  loadRuntime: () => void | Promise<void>;
  busy: Accessor<boolean>;
  list: Accessor<PluginPermissionInfo[]>;
  commandStatus: Accessor<string | null>;
  status: Accessor<PluginRuntimeStatus | null>;
  requestGrant: (plugin: PluginPermissionInfo, permission: string) => void | Promise<void>;
  runCommand: (command: PluginCommand) => void | Promise<void>;
  openPanel: (panel: PluginPanel) => void;
};

type SettingsPluginsTabProps = {
  plugins: SettingsPluginsProps;
};

export const SettingsPluginsTab = (props: SettingsPluginsTabProps) => (
  <>
    <Show when={props.plugins.error()}>
      <div class="settings-banner is-error">
        <div>
          <div class="settings-banner__title">Plugin error</div>
          <div class="settings-banner__message">{props.plugins.error()}</div>
        </div>
        <button
          class="settings-action"
          onClick={() => void props.plugins.loadRuntime()}
          disabled={props.plugins.busy()}
        >
          {props.plugins.busy() ? "Reloading..." : "Reload plugins"}
        </button>
      </div>
    </Show>
    <div class="settings-section">
      <h3 class="settings-section__title">Installed Plugins</h3>
      <Show
        when={props.plugins.list().length > 0}
        fallback={<p class="settings-section__desc">No plugins installed.</p>}
      >
        <For each={props.plugins.list()}>
          {(plugin) => (
            <div class={`settings-plugin ${plugin.enabled ? "" : "is-disabled"}`}>
              <div class="settings-plugin__info">
                <span class="settings-plugin__name">{plugin.name}</span>
                <span class="settings-plugin__version">{plugin.version}</span>
              </div>
              <Show when={plugin.description}>
                <p class="settings-plugin__desc">{plugin.description}</p>
              </Show>
              <Show when={plugin.missing_permissions.length > 0}>
                <div class="settings-plugin__permissions">
                  <For each={plugin.missing_permissions}>
                    {(perm) => (
                      <button
                        class="settings-action"
                        onClick={() => props.plugins.requestGrant(plugin, perm)}
                      >
                        Grant {perm}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <button
        class="settings-action is-primary"
        onClick={() => void props.plugins.loadRuntime()}
        disabled={props.plugins.busy()}
      >
        {props.plugins.busy() ? "Loading..." : "Reload plugins"}
      </button>
      <Show when={props.plugins.commandStatus()}>
        <div class="settings-message is-success">
          {props.plugins.commandStatus()}
        </div>
      </Show>
    </div>
    <div class="settings-section">
      <h3 class="settings-section__title">Plugin Commands</h3>
      <Show
        when={(props.plugins.status()?.commands ?? []).length > 0}
        fallback={<p class="settings-section__desc">No plugin commands available.</p>}
      >
        <For each={props.plugins.status()?.commands ?? []}>
          {(command) => (
            <div class="settings-row">
              <div>
                <div class="settings-value">{command.title}</div>
                <Show when={command.description}>
                  <div class="settings-label">{command.description}</div>
                </Show>
              </div>
              <button
                class="settings-action"
                onClick={() => props.plugins.runCommand(command)}
                disabled={props.plugins.busy()}
              >
                Run
              </button>
            </div>
          )}
        </For>
      </Show>
    </div>
    <div class="settings-section">
      <h3 class="settings-section__title">Plugin Panels</h3>
      <Show
        when={(props.plugins.status()?.panels ?? []).length > 0}
        fallback={<p class="settings-section__desc">No plugin panels available.</p>}
      >
        <For each={props.plugins.status()?.panels ?? []}>
          {(panel) => (
            <div class="settings-row">
              <div>
                <div class="settings-value">{panel.title}</div>
                <Show when={panel.location}>
                  <div class="settings-label">{panel.location}</div>
                </Show>
              </div>
              <button
                class="settings-action"
                onClick={() => props.plugins.openPanel(panel)}
                disabled={props.plugins.busy()}
              >
                Open
              </button>
            </div>
          )}
        </For>
      </Show>
    </div>
  </>
);
