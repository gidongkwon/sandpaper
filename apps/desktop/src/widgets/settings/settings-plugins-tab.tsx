import { For, Show, type Accessor, type Setter } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  PluginCommand,
  PluginInstallStatus,
  PluginPanel,
  PluginPermissionInfo,
  PluginRuntimeError,
  PluginRuntimeStatus
} from "../../entities/plugin/model/plugin-types";
import { PluginSettingsCard } from "./settings-plugin-settings";

type PluginSettingsStatus = {
  state: "idle" | "saving" | "success" | "error";
  message?: string;
};

type SettingsPluginsProps = {
  error: Accessor<string | null>;
  errorDetails: Accessor<PluginRuntimeError | null>;
  loadRuntime: () => void | Promise<void>;
  busy: Accessor<boolean>;
  list: Accessor<PluginPermissionInfo[]>;
  commandStatus: Accessor<string | null>;
  status: Accessor<PluginRuntimeStatus | null>;
  requestGrant: (plugin: PluginPermissionInfo, permission: string) => void | Promise<void>;
  runCommand: (command: PluginCommand) => void | Promise<void>;
  openPanel: (panel: PluginPanel) => void;
  installPath: Accessor<string>;
  setInstallPath: Setter<string>;
  installStatus: Accessor<PluginInstallStatus | null>;
  installing: Accessor<boolean>;
  installPlugin: () => void | Promise<void>;
  clearInstallStatus: () => void;
  settings: Accessor<Record<string, Record<string, unknown>>>;
  settingsDirty: Accessor<Record<string, boolean>>;
  settingsStatus: Accessor<Record<string, PluginSettingsStatus | null>>;
  updateSetting: (pluginId: string, key: string, value: unknown) => void;
  resetSettings: (pluginId: string) => void;
  saveSettings: (pluginId: string) => void | Promise<void>;
  devMode: Accessor<boolean>;
  setDevMode: (value: boolean) => void;
};

type SettingsPluginsTabProps = {
  isTauri: () => boolean;
  plugins: SettingsPluginsProps;
};

export const SettingsPluginsTab = (props: SettingsPluginsTabProps) => {
  let pluginFolderPickerRef: HTMLInputElement | undefined;
  const pluginsWithSettings = () =>
    props.plugins
      .list()
      .filter(
        (plugin) =>
          plugin.settings_schema &&
          Object.keys(plugin.settings_schema.properties ?? {}).length > 0
      );

  const getFolderFromFile = (file: File) => {
    const withPath = file as File & { path?: string; webkitRelativePath?: string };
    if (withPath.path) return withPath.path;
    if (withPath.webkitRelativePath) {
      return withPath.webkitRelativePath.split("/")[0] || "";
    }
    return file.name.replace(/\.[^/.]+$/, "");
  };

  const openPluginFolderPicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection === "string") {
        props.plugins.setInstallPath(selection);
        props.plugins.clearInstallStatus();
      }
      return;
    }
    pluginFolderPickerRef?.click();
  };

  const handlePluginFolderPick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const nextPath = getFolderFromFile(file);
    if (nextPath) {
      props.plugins.setInstallPath(nextPath);
      props.plugins.clearInstallStatus();
    }
    input.value = "";
  };

  return (
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
      <Show when={props.plugins.errorDetails()}>
        {(details) => (
          <div class="settings-section">
            <h3 class="settings-section__title">Plugin Error Details</h3>
            <div class="settings-section__desc">{details().message}</div>
            <Show when={details().context}>
              {(context) => (
                <div class="settings-error-context">
                  <span>Phase: {context().phase}</span>
                  <Show when={context().pluginId}>
                    {(value) => <span>Plugin: {value()}</span>}
                  </Show>
                  <Show when={context().rendererId}>
                    {(value) => <span>Renderer: {value()}</span>}
                  </Show>
                  <Show when={context().blockUid}>
                    {(value) => <span>Block: {value()}</span>}
                  </Show>
                  <Show when={context().actionId}>
                    {(value) => <span>Action: {value()}</span>}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={details().stack}>
              {(stack) => (
                <pre class="settings-error-stack">{stack()}</pre>
              )}
            </Show>
          </div>
        )}
      </Show>
      <div class="settings-section">
        <h3 class="settings-section__title">Developer Mode</h3>
        <p class="settings-section__desc">
          Auto-reload plugins every few seconds while you iterate locally.
        </p>
        <label class="settings-row settings-row--checkbox">
          <span class="settings-label">Auto reload plugins</span>
          <input
            type="checkbox"
            checked={props.plugins.devMode()}
            onChange={(event) => props.plugins.setDevMode(event.currentTarget.checked)}
          />
        </label>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Add plugin</h3>
        <p class="settings-section__desc">
          Install a plugin from a folder that contains a plugin.json manifest.
        </p>
        <div class="settings-file-row">
          <input
            class="settings-input"
            type="text"
            placeholder="Plugin folder path"
            value={props.plugins.installPath()}
            onInput={(e) => {
              props.plugins.setInstallPath(e.currentTarget.value);
              props.plugins.clearInstallStatus();
            }}
          />
          <button
            class="settings-action"
            type="button"
            onClick={() => void openPluginFolderPicker()}
          >
            Browse
          </button>
        </div>
        <input
          ref={(el) => {
            pluginFolderPickerRef = el;
            el.setAttribute("webkitdirectory", "");
            el.setAttribute("directory", "");
          }}
          data-testid="plugin-folder-picker"
          class="settings-file-input"
          type="file"
          onChange={handlePluginFolderPick}
        />
        <div class="settings-actions">
          <button
            class="settings-action is-primary"
            type="button"
            onClick={() => void props.plugins.installPlugin()}
            disabled={
              props.plugins.installing() || !props.plugins.installPath().trim()
            }
          >
            {props.plugins.installing() ? "Installing..." : "Install plugin"}
          </button>
          <button
            class="settings-action"
            type="button"
            onClick={() => {
              props.plugins.setInstallPath("");
              props.plugins.clearInstallStatus();
            }}
          >
            Clear
          </button>
        </div>
        <Show when={props.plugins.installStatus()}>
          {(status) => (
            <div
              class={`settings-message ${
                status().state === "success" ? "is-success" : "is-error"
              }`}
            >
              {status().message}
            </div>
          )}
        </Show>
      </div>
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
        <h3 class="settings-section__title">Plugin Settings</h3>
        <Show
          when={pluginsWithSettings().length > 0}
          fallback={
            <p class="settings-section__desc">
              No plugin settings available.
            </p>
          }
        >
          <For each={pluginsWithSettings()}>
            {(plugin) => (
              <PluginSettingsCard
                plugin={plugin}
                schema={plugin.settings_schema!}
                values={props.plugins.settings()[plugin.id] ?? {}}
                dirty={Boolean(props.plugins.settingsDirty()[plugin.id])}
                busy={props.plugins.busy()}
                status={props.plugins.settingsStatus()[plugin.id] ?? null}
                onChange={(key, value) =>
                  props.plugins.updateSetting(plugin.id, key, value)
                }
                onReset={() => props.plugins.resetSettings(plugin.id)}
                onSave={() => void props.plugins.saveSettings(plugin.id)}
              />
            )}
          </For>
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
};
