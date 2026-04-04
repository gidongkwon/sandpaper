import * as Dialog from "@kobalte/core/dialog";
import * as Tabs from "@kobalte/core/tabs";
import { For, type Accessor, type JSX, type Setter } from "solid-js";
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
import type { ThemeMode } from "../../pages/main-page/model/use-theme-mode";

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
  theme: {
    mode: Accessor<ThemeMode>;
    setMode: Setter<ThemeMode>;
  };
  statusSurfaces: {
    showStatusSurfaces: Accessor<boolean>;
    setShowStatusSurfaces: Setter<boolean>;
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
  const tabs: Array<{
    value: SettingsTab;
    label: string;
    icon: () => JSX.Element;
  }> = [
    {
      value: "general",
      label: "General",
      icon: () => <Settings16Icon width="14" height="14" />
    },
    {
      value: "vault",
      label: "Vault",
      icon: () => <LockClosed16Icon width="14" height="14" />
    },
    {
      value: "sync",
      label: "Sync",
      icon: () => <ArrowSync16Icon width="14" height="14" />
    },
    {
      value: "plugins",
      label: "Plugins",
      icon: () => <PuzzlePiece16Icon width="14" height="14" />
    },
    {
      value: "permissions",
      label: "Permissions",
      icon: () => <ShieldCheckmark16Icon width="14" height="14" />
    },
    {
      value: "import",
      label: "Import",
      icon: () => <ArrowUpload16Icon width="14" height="14" />
    }
  ];

  return (
    <Dialog.Root
      open={props.open()}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <div class="modal-backdrop">
          <Dialog.Overlay class="modal-backdrop__overlay" />
          <Dialog.Content class="settings-modal">
            <div class="settings-modal__header">
              <Dialog.Title id="settings-title">Settings</Dialog.Title>
              <IconButton
                class="settings-modal__close"
                label="Close settings"
                onClick={() => props.onClose()}
              >
                <Dismiss12Icon width="14" height="14" />
              </IconButton>
            </div>
            <Tabs.Root
              class="settings-modal__body"
              value={props.tab()}
              onChange={props.setTab}
              orientation="vertical"
            >
              <Tabs.List class="settings-nav" aria-label="Settings sections">
                <For each={tabs}>
                  {(tab) => (
                    <Tabs.Trigger class="settings-nav__item" value={tab.value}>
                      {tab.icon()}
                      {tab.label}
                    </Tabs.Trigger>
                  )}
                </For>
              </Tabs.List>
              <Tabs.Content class="settings-content" value="general">
                <SettingsGeneralTab
                  typeScale={typeScale}
                  theme={props.theme}
                  statusSurfaces={props.statusSurfaces}
                  activeVault={vault.active}
                />
              </Tabs.Content>
              <Tabs.Content class="settings-content" value="vault">
                <SettingsVaultTab isTauri={props.isTauri} vault={vault} />
              </Tabs.Content>
              <Tabs.Content class="settings-content" value="sync">
                <SettingsSyncTab
                  isTauri={props.isTauri}
                  vaultKeyStatus={vault.keyStatus}
                  sync={sync}
                />
              </Tabs.Content>
              <Tabs.Content class="settings-content" value="plugins">
                <SettingsPluginsTab
                  isTauri={props.isTauri}
                  plugins={plugins}
                />
              </Tabs.Content>
              <Tabs.Content class="settings-content" value="permissions">
                <SettingsPermissionsTab plugins={plugins} />
              </Tabs.Content>
              <Tabs.Content class="settings-content" value="import">
                <SettingsImportTab
                  isTauri={props.isTauri}
                  importExport={importExport}
                />
              </Tabs.Content>
            </Tabs.Root>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
