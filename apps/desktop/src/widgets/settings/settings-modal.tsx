import { Show, type Accessor, type Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { PluginCommand, PluginPanel, PluginPermissionInfo, PluginRuntimeStatus } from "../../entities/plugin/model/plugin-types";
import type { SyncConfig, SyncConflict, SyncLogEntry, SyncStatus } from "../../entities/sync/model/sync-types";
import type { VaultKeyStatus, VaultRecord } from "../../entities/vault/model/vault-types";
import type { PageId, VaultId } from "../../shared/model/id-types";
import { IconButton } from "../../shared/ui/icon-button";
import { SettingsGeneralTab } from "./settings-general-tab";
import { SettingsImportTab } from "./settings-import-tab";
import { SettingsPermissionsTab } from "./settings-permissions-tab";
import { SettingsPluginsTab } from "./settings-plugins-tab";
import { SettingsSyncTab } from "./settings-sync-tab";
import { SettingsVaultTab } from "./settings-vault-tab";

type SettingsTab = "general" | "vault" | "sync" | "plugins" | "permissions" | "import";

type StatusMessage = {
  state: "success" | "error";
  message: string;
};

type ExportStatus = {
  state: "success" | "error";
  message: string;
  preview?: string;
};

type SettingsModalProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  tab: Accessor<SettingsTab>;
  setTab: Setter<SettingsTab>;
  isTauri: () => boolean;
  typeScale: {
    value: Accessor<number>;
    set: Setter<number>;
    min: number;
    max: number;
    step: number;
    defaultPosition: string;
  };
  vault: {
    active: Accessor<VaultRecord | null>;
    list: Accessor<VaultRecord[]>;
    applyActiveVault: (id: VaultId) => void;
    formOpen: Accessor<boolean>;
    setFormOpen: Setter<boolean>;
    newName: Accessor<string>;
    setNewName: Setter<string>;
    newPath: Accessor<string>;
    setNewPath: Setter<string>;
    create: () => void | Promise<void>;
    shadowPendingCount: Accessor<number>;
    keyStatus: Accessor<VaultKeyStatus>;
    passphrase: Accessor<string>;
    setPassphrase: Setter<string>;
    keyBusy: Accessor<boolean>;
    setKey: () => void | Promise<void>;
    keyMessage: Accessor<string | null>;
  };
  sync: {
    status: Accessor<SyncStatus>;
    stateLabel: Accessor<string>;
    stateDetail: Accessor<string>;
    serverUrl: Accessor<string>;
    setServerUrl: Setter<string>;
    vaultIdInput: Accessor<string>;
    setVaultIdInput: Setter<string>;
    deviceIdInput: Accessor<string>;
    setDeviceIdInput: Setter<string>;
    busy: Accessor<boolean>;
    connected: Accessor<boolean>;
    connect: () => void | Promise<void>;
    syncNow: () => void | Promise<void>;
    message: Accessor<string | null>;
    config: Accessor<SyncConfig | null>;
    log: Accessor<SyncLogEntry[]>;
    copyLog: () => void | Promise<void>;
    conflicts: Accessor<SyncConflict[]>;
    resolveConflict: (
      conflict: SyncConflict,
      resolution: "local" | "remote" | "merge",
      mergeText?: string
    ) => void | Promise<void>;
    startMerge: (conflict: SyncConflict) => void;
    cancelMerge: () => void;
    mergeId: Accessor<string | null>;
    mergeDrafts: Record<string, string>;
    setMergeDrafts: SetStoreFunction<Record<string, string>>;
    getConflictPageTitle: (pageUid: PageId) => string;
  };
  plugins: {
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
  importExport: {
    importText: Accessor<string>;
    setImportText: Setter<string>;
    importStatus: Accessor<StatusMessage | null>;
    setImportStatus: Setter<StatusMessage | null>;
    importing: Accessor<boolean>;
    importMarkdown: () => void | Promise<void>;
    exporting: Accessor<boolean>;
    exportMarkdown: () => void | Promise<void>;
    exportStatus: Accessor<ExportStatus | null>;
    offlineExporting: Accessor<boolean>;
    exportOfflineArchive: () => void | Promise<void>;
    offlineExportStatus: Accessor<StatusMessage | null>;
    offlineImporting: Accessor<boolean>;
    importOfflineArchive: () => void | Promise<void>;
    offlineImportFile: Accessor<File | null>;
    setOfflineImportFile: Setter<File | null>;
    offlineImportStatus: Accessor<StatusMessage | null>;
    setOfflineImportStatus: Setter<StatusMessage | null>;
  };
};

export const SettingsModal = (props: SettingsModalProps) => {
  /* eslint-disable solid/reactivity */
  const vault = props.vault;
  const sync = props.sync;
  const plugins = props.plugins;
  const importExport = props.importExport;
  const typeScale = props.typeScale;
  /* eslint-enable solid/reactivity */

  return (
    <Show when={props.open()}>
      <div
        class="modal-backdrop"
        onClick={(event) => event.target === event.currentTarget && props.onClose()}
      >
        <div
          class="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <div class="settings-modal__header">
            <h2 id="settings-title">Settings</h2>
            <IconButton
              class="settings-modal__close"
              label="Close settings"
              onClick={() => props.onClose()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
          <div class="settings-modal__body">
            <nav class="settings-nav">
              <button
                class={`settings-nav__item ${props.tab() === "general" ? "is-active" : ""}`}
                onClick={() => props.setTab("general")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                General
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "vault" ? "is-active" : ""}`}
                onClick={() => props.setTab("vault")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Vault
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "sync" ? "is-active" : ""}`}
                onClick={() => props.setTab("sync")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                Sync
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "plugins" ? "is-active" : ""}`}
                onClick={() => props.setTab("plugins")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                Plugins
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "permissions" ? "is-active" : ""}`}
                onClick={() => props.setTab("permissions")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v5c0 5-3.5 9-7 9s-7-4-7-9V7l7-4z" /><path d="M9 12l2 2 4-4" /></svg>
                Permissions
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "import" ? "is-active" : ""}`}
                onClick={() => props.setTab("import")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                Import
              </button>
            </nav>
            <div class="settings-content">
              <Show when={props.tab() === "general"}>
                <SettingsGeneralTab
                  typeScale={typeScale}
                  activeVault={vault.active}
                />
              </Show>
              <Show when={props.tab() === "vault"}>
                <SettingsVaultTab isTauri={props.isTauri} vault={vault} />
              </Show>
              <Show when={props.tab() === "sync"}>
                <SettingsSyncTab
                  isTauri={props.isTauri}
                  vaultKeyStatus={vault.keyStatus}
                  sync={sync}
                />
              </Show>
              <Show when={props.tab() === "plugins"}>
                <SettingsPluginsTab plugins={plugins} />
              </Show>
              <Show when={props.tab() === "permissions"}>
                <SettingsPermissionsTab plugins={plugins} />
              </Show>
              <Show when={props.tab() === "import"}>
                <SettingsImportTab
                  isTauri={props.isTauri}
                  importExport={importExport}
                />
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
