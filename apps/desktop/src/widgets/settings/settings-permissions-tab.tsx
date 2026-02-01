import { For, Show, type Accessor } from "solid-js";
import type { PluginPermissionInfo } from "../../entities/plugin/model/plugin-types";

type SettingsPermissionsTabProps = {
  plugins: {
    list: Accessor<PluginPermissionInfo[]>;
  };
};

export const SettingsPermissionsTab = (props: SettingsPermissionsTabProps) => (
  <div class="settings-section">
    <h3 class="settings-section__title">Permission Audit</h3>
    <p class="settings-section__desc">
      Review required permissions, missing grants, and unused grants.
    </p>
    <div class="settings-permission-legend">
      <span class="settings-permission is-granted">Granted</span>
      <span class="settings-permission is-missing">Missing</span>
      <span class="settings-permission is-unused">Unused</span>
    </div>
    <Show
      when={props.plugins.list().length > 0}
      fallback={<p class="settings-section__desc">No plugins installed.</p>}
    >
      <For each={props.plugins.list()}>
        {(plugin) => {
          const missing = plugin.missing_permissions;
          const unused = plugin.granted_permissions.filter(
            (perm) => !plugin.permissions.includes(perm)
          );
          const orderedPermissions = [...plugin.permissions, ...unused];
          const showPermissions = orderedPermissions.length > 0;
          return (
            <div class="settings-permission-card">
              <div class="settings-permission-header">
                <span class="settings-permission-name">{plugin.name}</span>
                <span class="settings-permission-version">{plugin.version}</span>
              </div>
              <Show when={plugin.description}>
                <p class="settings-section__desc">{plugin.description}</p>
              </Show>
              <Show
                when={showPermissions}
                fallback={<p class="settings-section__desc">No permissions requested.</p>}
              >
                <div class="settings-permission-list">
                  <For each={orderedPermissions}>
                    {(perm) => (
                      <span
                        class={`settings-permission ${
                          missing.includes(perm)
                            ? "is-missing"
                            : unused.includes(perm)
                              ? "is-unused"
                              : "is-granted"
                        }`}
                      >
                        {perm}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={missing.length > 0}>
                <p class="settings-permission-note is-missing">
                  Missing: {missing.join(", ")}
                </p>
              </Show>
              <Show when={unused.length > 0}>
                <p class="settings-permission-note is-unused">
                  Unused grants: {unused.join(", ")}
                </p>
              </Show>
            </div>
          );
        }}
      </For>
    </Show>
  </div>
);
