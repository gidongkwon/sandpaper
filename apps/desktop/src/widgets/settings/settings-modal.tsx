import { Show, type Accessor, type Setter } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type {
  PluginCommand,
  PluginInstallStatus,
  PluginPanel,
  PluginPermissionInfo,
  PluginRuntimeError,
  PluginRuntimeStatus
} from "../../entities/plugin/model/plugin-types";
import type { SyncConfig, SyncConflict, SyncLogEntry, SyncStatus } from "../../entities/sync/model/sync-types";
import type { VaultKeyStatus, VaultRecord } from "../../entities/vault/model/vault-types";
import type { PageId, VaultId } from "../../shared/model/id-types";
import { IconButton } from "../../shared/ui/icon-button";
import {
  ArrowSync16Icon,
  ArrowUpload16Icon,
  Dismiss12Icon,
  LockClosed16Icon,
  PuzzlePiece16Icon,
  Settings16Icon,
  ShieldCheckmark16Icon
} from "../../shared/ui/icons";
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

type PluginSettingsStatus = {
  state: "idle" | "saving" | "success" | "error";
  message?: string;
};

type PluginManageStatus = {
  state: "idle" | "working" | "success" | "error";
  message?: string;
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
  statusSurfaces: {
    showStatusSurfaces: Accessor<boolean>;
    setShowStatusSurfaces: Setter<boolean>;
    showShortcutHints: Accessor<boolean>;
    setShowShortcutHints: Setter<boolean>;
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
    updatePlugin: (pluginId: string) => void | Promise<void>;
    removePlugin: (pluginId: string) => void | Promise<void>;
    clearInstallStatus: () => void;
    manageStatus: Accessor<Record<string, PluginManageStatus | null>>;
    settings: Accessor<Record<string, Record<string, unknown>>>;
    settingsDirty: Accessor<Record<string, boolean>>;
    settingsStatus: Accessor<Record<string, PluginSettingsStatus | null>>;
    updateSetting: (pluginId: string, key: string, value: unknown) => void;
    resetSettings: (pluginId: string) => void;
    saveSettings: (pluginId: string) => void | Promise<void>;
    devMode: Accessor<boolean>;
    setDevMode: (value: boolean) => void;
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
  // These props are stable objects/accessors; destructuring is safe and avoids verbose prop chains.
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
              <Dismiss12Icon width="14" height="14" />
            </IconButton>
          </div>
          <div class="settings-modal__body">
            <nav class="settings-nav">
              <button
                class={`settings-nav__item ${props.tab() === "general" ? "is-active" : ""}`}
                onClick={() => props.setTab("general")}
              >
                <Settings16Icon width="14" height="14" />
                General
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "vault" ? "is-active" : ""}`}
                onClick={() => props.setTab("vault")}
              >
                <LockClosed16Icon width="14" height="14" />
                Vault
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "sync" ? "is-active" : ""}`}
                onClick={() => props.setTab("sync")}
              >
                <ArrowSync16Icon width="14" height="14" />
                Sync
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "plugins" ? "is-active" : ""}`}
                onClick={() => props.setTab("plugins")}
              >
                <PuzzlePiece16Icon width="14" height="14" />
                Plugins
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "permissions" ? "is-active" : ""}`}
                onClick={() => props.setTab("permissions")}
              >
                <ShieldCheckmark16Icon width="14" height="14" />
                Permissions
              </button>
              <button
                class={`settings-nav__item ${props.tab() === "import" ? "is-active" : ""}`}
                onClick={() => props.setTab("import")}
              >
                <ArrowUpload16Icon width="14" height="14" />
                Import
              </button>
            </nav>
            <div class="settings-content">
              <Show when={props.tab() === "general"}>
                <SettingsGeneralTab
                  typeScale={typeScale}
                  statusSurfaces={props.statusSurfaces}
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
                <SettingsPluginsTab
                  isTauri={props.isTauri}
                  plugins={plugins}
                />
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
