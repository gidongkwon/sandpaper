import { For, Show, createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { SetStoreFunction } from "solid-js/store";
import type { PluginCommand, PluginPanel, PluginPermissionInfo, PluginRuntimeStatus } from "../../entities/plugin/model/plugin-types";
import type { SyncConfig, SyncConflict, SyncLogEntry, SyncStatus } from "../../entities/sync/model/sync-types";
import type { VaultKeyStatus, VaultRecord } from "../../entities/vault/model/vault-types";
import { ensureMermaid } from "../../shared/lib/diagram/mermaid";
import { makeRandomId } from "../../shared/lib/id/id-factory";

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
    applyActiveVault: (id: string) => void;
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
    getConflictPageTitle: (pageUid: string) => string;
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

const SyncConflictDiagram = () => {
  const [svg, setSvg] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let containerRef: HTMLDivElement | undefined;
  let renderToken = 0;

  createEffect(() => {
    const token = (renderToken += 1);
    setSvg(null);
    setError(null);
    const content = "flowchart LR\n  L[Local edit] --> C{Conflict}\n  R[Remote edit] --> C\n  C --> M[Merged result]";

    void (async () => {
      try {
        const engine = ensureMermaid();
        const result = await engine.render(
          `mermaid-sync-${makeRandomId()}`,
          content
        );
        if (token !== renderToken) return;
        setSvg(result.svg ?? "");
        if (result.bindFunctions && containerRef) {
          Promise.resolve().then(() => {
            if (token !== renderToken) return;
            result.bindFunctions?.(containerRef);
          });
        }
      } catch {
        if (token !== renderToken) return;
        setError("Conflict diagram unavailable.");
      }
    })();
  });

  return (
    <div class="sync-conflict-diagram">
      <Show
        when={svg()}
        fallback={
          <div class="sync-conflict-diagram__fallback">
            {error() ?? "Rendering conflict diagram..."}
          </div>
        }
      >
        {(value) => (
          <div
            ref={containerRef}
            class="sync-conflict-diagram__svg"
            innerHTML={value() ?? ""}
          />
        )}
      </Show>
    </div>
  );
};

export const SettingsModal = (props: SettingsModalProps) => {
  /* eslint-disable solid/reactivity */
  const vault = props.vault;
  const sync = props.sync;
  const plugins = props.plugins;
  const importExport = props.importExport;
  const typeScale = props.typeScale;
  /* eslint-enable solid/reactivity */

  let vaultFolderPickerRef: HTMLInputElement | undefined;
  let markdownFilePickerRef: HTMLInputElement | undefined;
  let offlineArchivePickerRef: HTMLInputElement | undefined;

  const getFolderFromFile = (file: File) => {
    const withPath = file as File & { path?: string; webkitRelativePath?: string };
    if (withPath.path) return withPath.path;
    if (withPath.webkitRelativePath) {
      return withPath.webkitRelativePath.split("/")[0] || "";
    }
    return file.name.replace(/\.[^/.]+$/, "");
  };

  const readTextFile = async (file: File) => {
    if (typeof file.text === "function") {
      return file.text();
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
      reader.readAsText(file);
    });
  };

  const openVaultFolderPicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection === "string") {
        vault.setNewPath(selection);
      }
      return;
    }
    vaultFolderPickerRef?.click();
  };

  const openMarkdownFilePicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
      });
      const picked =
        typeof selection === "string" ? selection : selection?.[0] ?? null;
      if (!picked) return;
      try {
        const text = (await invoke("read_text_file", { path: picked })) as string;
        importExport.setImportText(text);
        importExport.setImportStatus(null);
      } catch (error) {
        console.error("Failed to read import file", error);
        importExport.setImportStatus({
          state: "error",
          message: "Failed to read the selected file."
        });
      }
      return;
    }
    markdownFilePickerRef?.click();
  };

  const openOfflineArchivePicker = () => {
    offlineArchivePickerRef?.click();
  };

  const handleVaultFolderPick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const nextPath = getFolderFromFile(file);
    if (nextPath) {
      vault.setNewPath(nextPath);
    }
    input.value = "";
  };

  const handleMarkdownFilePick = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await readTextFile(file);
      importExport.setImportText(text);
      importExport.setImportStatus(null);
    } catch (error) {
      console.error("Failed to read import file", error);
      importExport.setImportStatus({
        state: "error",
        message: "Failed to read the selected file."
      });
    } finally {
      input.value = "";
    }
  };

  const handleOfflineArchivePick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    importExport.setOfflineImportFile(file);
    importExport.setOfflineImportStatus(null);
  };

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
            <button
              class="settings-modal__close"
              onClick={() => props.onClose()}
              aria-label="Close settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
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
                <div class="settings-section">
                  <h3 class="settings-section__title">Typography</h3>
                  <p class="settings-section__desc">Adjust the text size across the interface.</p>
                  <div class="settings-slider">
                    <div class="settings-slider__header">
                      <label class="settings-label">Text size</label>
                      <span class="settings-value">{Math.round(typeScale.value() * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      class="settings-slider__input"
                      min={typeScale.min}
                      max={typeScale.max}
                      step={typeScale.step}
                      value={typeScale.value()}
                      onInput={(e) => typeScale.set(parseFloat(e.currentTarget.value))}
                    />
                    <div
                      class="settings-slider__labels"
                      style={{ "--default-position": typeScale.defaultPosition }}
                    >
                      <span class="settings-slider__label is-min">Compact</span>
                      <span class="settings-slider__label is-default">Default</span>
                      <span class="settings-slider__label is-max">Large</span>
                    </div>
                  </div>
                </div>
                <div class="settings-section">
                  <h3 class="settings-section__title">Appearance</h3>
                  <p class="settings-section__desc">Sandpaper follows your system color scheme.</p>
                  <div class="settings-row">
                    <label class="settings-label">Current vault</label>
                    <span class="settings-value">{vault.active()?.name ?? "Default"}</span>
                  </div>
                </div>
              </Show>
              <Show when={props.tab() === "vault"}>
                <div class="settings-section">
                  <h3 class="settings-section__title">Active Vault</h3>
                  <select
                    class="settings-select"
                    value={vault.active()?.id ?? ""}
                    onChange={(e) => vault.applyActiveVault(e.currentTarget.value)}
                  >
                    <For each={vault.list()}>
                      {(entry) => <option value={entry.id}>{entry.name}</option>}
                    </For>
                  </select>
                  <button
                    class="settings-action"
                    onClick={() => vault.setFormOpen((prev) => !prev)}
                  >
                    {vault.formOpen() ? "Cancel" : "New vault"}
                  </button>
                  <Show when={vault.formOpen()}>
                    <div class="settings-form">
                      <input
                        class="settings-input"
                        type="text"
                        placeholder="Vault name"
                        value={vault.newName()}
                        onInput={(e) => vault.setNewName(e.currentTarget.value)}
                      />
                      <div class="settings-file-row">
                        <input
                          class="settings-input"
                          type="text"
                          placeholder="Vault path"
                          value={vault.newPath()}
                          onInput={(e) => vault.setNewPath(e.currentTarget.value)}
                        />
                        <button
                          class="settings-action"
                          type="button"
                          onClick={openVaultFolderPicker}
                        >
                          Browse
                        </button>
                      </div>
                      <input
                        ref={(el) => {
                          vaultFolderPickerRef = el;
                          el.setAttribute("webkitdirectory", "");
                          el.setAttribute("directory", "");
                        }}
                        data-testid="vault-folder-picker"
                        class="settings-file-input"
                        type="file"
                        onChange={handleVaultFolderPick}
                      />
                      <button class="settings-action is-primary" onClick={vault.create}>Create vault</button>
                    </div>
                  </Show>
                  <div class="settings-row">
                    <label class="settings-label">Shadow write queue</label>
                    <span
                      class={`settings-value ${
                        vault.shadowPendingCount() > 0 ? "is-warning" : "is-success"
                      }`}
                    >
                      {vault.shadowPendingCount()} pending
                    </span>
                  </div>
                </div>
                <div class="settings-section">
                  <h3 class="settings-section__title">Encryption Key</h3>
                  <p class="settings-section__desc">
                    {vault.keyStatus().configured
                      ? `Configured (${vault.keyStatus().kdf ?? "pbkdf2-sha256"})`
                      : "Set a passphrase to enable E2E encryption."}
                  </p>
                  <input
                    class="settings-input"
                    type="password"
                    placeholder="Passphrase"
                    value={vault.passphrase()}
                    onInput={(e) => vault.setPassphrase(e.currentTarget.value)}
                  />
                  <div class="settings-actions">
                    <button
                      class="settings-action is-primary"
                      disabled={vault.keyBusy() || !vault.passphrase().trim()}
                      onClick={vault.setKey}
                    >
                      {vault.keyBusy() ? "Deriving..." : "Set passphrase"}
                    </button>
                    <button class="settings-action" onClick={() => vault.setPassphrase("")}>Clear</button>
                  </div>
                  <Show when={vault.keyMessage()}>
                    <div class="settings-message">{vault.keyMessage()}</div>
                  </Show>
                </div>
              </Show>
              <Show when={props.tab() === "sync"}>
                <div class="settings-section">
                  <h3 class="settings-section__title">Connection</h3>
                  <div class="settings-status">
                    <span class={`settings-status__dot ${sync.status().state}`} />
                    <span class="settings-status__label">{sync.stateLabel()}</span>
                  </div>
                  <p class="settings-section__desc">{sync.stateDetail()}</p>
                  <input
                    class="settings-input"
                    type="text"
                    placeholder="Sync server URL"
                    value={sync.serverUrl()}
                    onInput={(e) => sync.setServerUrl(e.currentTarget.value)}
                  />
                  <input
                    class="settings-input"
                    type="text"
                    placeholder="Vault ID (optional)"
                    value={sync.vaultIdInput()}
                    onInput={(e) => sync.setVaultIdInput(e.currentTarget.value)}
                  />
                  <input
                    class="settings-input"
                    type="text"
                    placeholder="Device ID (optional)"
                    value={sync.deviceIdInput()}
                    onInput={(e) => sync.setDeviceIdInput(e.currentTarget.value)}
                  />
                  <div class="settings-actions">
                    <button
                      class="settings-action is-primary"
                      disabled={!props.isTauri() || sync.busy() || !vault.keyStatus().configured || !sync.serverUrl().trim()}
                      onClick={sync.connect}
                    >
                      {sync.busy() ? "Connecting..." : "Connect"}
                    </button>
                    <button
                      class="settings-action"
                      disabled={!props.isTauri() || sync.busy() || !sync.connected()}
                      onClick={sync.syncNow}
                    >
                      Sync now
                    </button>
                  </div>
                  <Show when={sync.message()}>
                    <div class="settings-message">{sync.message()}</div>
                  </Show>
                </div>
                <Show when={sync.connected()}>
                  <div class="settings-section">
                    <h3 class="settings-section__title">Statistics</h3>
                    <div class="settings-stats">
                      <div class="settings-stat"><span class="settings-stat__value">{sync.status().pending_ops}</span><span class="settings-stat__label">Queue</span></div>
                      <div class="settings-stat"><span class="settings-stat__value">{sync.status().last_push_count}</span><span class="settings-stat__label">Pushed</span></div>
                      <div class="settings-stat"><span class="settings-stat__value">{sync.status().last_pull_count}</span><span class="settings-stat__label">Pulled</span></div>
                      <div class="settings-stat"><span class="settings-stat__value">{sync.status().last_apply_count}</span><span class="settings-stat__label">Applied</span></div>
                    </div>
                    <div class="settings-row"><label class="settings-label">Vault ID</label><code class="settings-code">{sync.config()?.vault_id}</code></div>
                    <div class="settings-row"><label class="settings-label">Device ID</label><code class="settings-code">{sync.config()?.device_id}</code></div>
                  </div>
                  <div class="settings-section">
                    <div class="settings-section__header">
                      <h3 class="settings-section__title">Activity log</h3>
                      <button
                        class="settings-action"
                        onClick={sync.copyLog}
                        disabled={sync.log().length === 0}
                      >
                        Copy log
                      </button>
                    </div>
                    <Show
                      when={sync.log().length > 0}
                      fallback={
                        <p class="settings-section__desc">
                          No sync activity yet.
                        </p>
                      }
                    >
                      <div class="sync-log">
                        <For each={[...sync.log()].reverse()}>
                          {(entry) => (
                            <div
                              class={`sync-log__row ${
                                entry.status === "error" ? "is-error" : ""
                              }`}
                            >
                              <span class="sync-log__time">{entry.at}</span>
                              <span class={`sync-log__action is-${entry.action}`}>
                                {entry.action}
                              </span>
                              <span class="sync-log__count">{entry.count}</span>
                              <Show when={entry.detail}>
                                <span class="sync-log__detail">{entry.detail}</span>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <Show when={sync.conflicts().length > 0}>
                    <div class="settings-section">
                      <div class="settings-section__header">
                        <h3 class="settings-section__title">Sync conflicts</h3>
                        <span class="sync-conflict-count">
                          {sync.conflicts().length} open
                        </span>
                      </div>
                      <p class="settings-section__desc">
                        Conflicting edits were detected during sync. Choose a
                        version or merge the text before continuing.
                      </p>
                      <SyncConflictDiagram />
                      <div class="sync-conflicts">
                        <For each={sync.conflicts()}>
                          {(conflict) => (
                            <div class="sync-conflict">
                              <div class="sync-conflict__header">
                                <div>
                                  <div class="sync-conflict__title">
                                    {sync.getConflictPageTitle(conflict.page_uid)}
                                  </div>
                                  <div class="sync-conflict__meta">
                                    Block {conflict.block_uid}
                                  </div>
                                </div>
                              </div>
                              <div class="sync-conflict__diff">
                                <div class="sync-conflict__pane is-local">
                                  <div class="sync-conflict__label">Local</div>
                                  <pre class="sync-conflict__text">
                                    {conflict.local_text}
                                  </pre>
                                </div>
                                <div class="sync-conflict__pane is-remote">
                                  <div class="sync-conflict__label">Remote</div>
                                  <pre class="sync-conflict__text">
                                    {conflict.remote_text}
                                  </pre>
                                </div>
                              </div>
                              <div class="sync-conflict__actions">
                                <button
                                  class="settings-action"
                                  onClick={() =>
                                    void sync.resolveConflict(conflict, "local")
                                  }
                                >
                                  Use local
                                </button>
                                <button
                                  class="settings-action"
                                  onClick={() =>
                                    void sync.resolveConflict(conflict, "remote")
                                  }
                                >
                                  Use remote
                                </button>
                                <button
                                  class="settings-action is-primary"
                                  onClick={() => sync.startMerge(conflict)}
                                >
                                  Merge
                                </button>
                              </div>
                              <Show when={sync.mergeId() === conflict.op_id}>
                                <div class="sync-conflict__merge">
                                  <label class="sync-conflict__label">Merged</label>
                                  <textarea
                                    class="sync-conflict__textarea"
                                    value={sync.mergeDrafts[conflict.op_id] ?? ""}
                                    onInput={(event) =>
                                      sync.setMergeDrafts(
                                        conflict.op_id,
                                        event.currentTarget.value
                                      )
                                    }
                                  />
                                  <div class="sync-conflict__actions">
                                    <button
                                      class="settings-action is-primary"
                                      onClick={() =>
                                        void sync.resolveConflict(
                                          conflict,
                                          "merge",
                                          sync.mergeDrafts[conflict.op_id] ?? ""
                                        )
                                      }
                                    >
                                      Apply merge
                                    </button>
                                    <button
                                      class="settings-action"
                                      onClick={sync.cancelMerge}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </Show>
              </Show>
              <Show when={props.tab() === "plugins"}>
                <Show when={plugins.error()}>
                  <div class="settings-banner is-error">
                    <div>
                      <div class="settings-banner__title">Plugin error</div>
                      <div class="settings-banner__message">{plugins.error()}</div>
                    </div>
                    <button
                      class="settings-action"
                      onClick={plugins.loadRuntime}
                      disabled={plugins.busy()}
                    >
                      {plugins.busy() ? "Reloading..." : "Reload plugins"}
                    </button>
                  </div>
                </Show>
                <div class="settings-section">
                  <h3 class="settings-section__title">Installed Plugins</h3>
                  <Show
                    when={plugins.list().length > 0}
                    fallback={<p class="settings-section__desc">No plugins installed.</p>}
                  >
                    <For each={plugins.list()}>
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
                                    onClick={() => plugins.requestGrant(plugin, perm)}
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
                    onClick={plugins.loadRuntime}
                    disabled={plugins.busy()}
                  >
                    {plugins.busy() ? "Loading..." : "Reload plugins"}
                  </button>
                  <Show when={plugins.commandStatus()}>
                    <div class="settings-message is-success">{plugins.commandStatus()}</div>
                  </Show>
                </div>
                <div class="settings-section">
                  <h3 class="settings-section__title">Plugin Commands</h3>
                  <Show
                    when={(plugins.status()?.commands ?? []).length > 0}
                    fallback={<p class="settings-section__desc">No plugin commands available.</p>}
                  >
                    <For each={plugins.status()?.commands ?? []}>
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
                            onClick={() => plugins.runCommand(command)}
                            disabled={plugins.busy()}
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
                    when={(plugins.status()?.panels ?? []).length > 0}
                    fallback={<p class="settings-section__desc">No plugin panels available.</p>}
                  >
                    <For each={plugins.status()?.panels ?? []}>
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
                            onClick={() => plugins.openPanel(panel)}
                            disabled={plugins.busy()}
                          >
                            Open
                          </button>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
              <Show when={props.tab() === "permissions"}>
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
                    when={plugins.list().length > 0}
                    fallback={<p class="settings-section__desc">No plugins installed.</p>}
                  >
                    <For each={plugins.list()}>
                      {(plugin) => {
                        const missing = plugin.missing_permissions;
                        const unused = plugin.granted_permissions.filter(
                          (perm) => !plugin.permissions.includes(perm)
                        );
                        const orderedPermissions = [
                          ...plugin.permissions,
                          ...unused
                        ];
                        const showPermissions = orderedPermissions.length > 0;
                        return (
                          <div class="settings-permission-card">
                            <div class="settings-permission-header">
                              <span class="settings-permission-name">
                                {plugin.name}
                              </span>
                              <span class="settings-permission-version">
                                {plugin.version}
                              </span>
                            </div>
                            <Show when={plugin.description}>
                              <p class="settings-section__desc">
                                {plugin.description}
                              </p>
                            </Show>
                            <Show
                              when={showPermissions}
                              fallback={
                                <p class="settings-section__desc">
                                  No permissions requested.
                                </p>
                              }
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
              </Show>
              <Show when={props.tab() === "import"}>
                <div class="settings-section">
                  <h3 class="settings-section__title">Import Markdown</h3>
                  <p class="settings-section__desc">Paste shadow Markdown to create or update a page.</p>
                  <textarea
                    class="settings-textarea"
                    rows={5}
                    placeholder="Paste markdown here..."
                    value={importExport.importText()}
                    onInput={(e) => importExport.setImportText(e.currentTarget.value)}
                  />
                  <div class="settings-actions">
                    <button
                      class="settings-action"
                      type="button"
                      onClick={openMarkdownFilePicker}
                    >
                      Choose file
                    </button>
                    <button
                      class="settings-action is-primary"
                      onClick={importExport.importMarkdown}
                      disabled={importExport.importing()}
                    >
                      {importExport.importing() ? "Importing..." : "Import"}
                    </button>
                    <button
                      class="settings-action"
                      onClick={() => {
                        importExport.setImportText("");
                        importExport.setImportStatus(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <input
                    ref={(el) => {
                      markdownFilePickerRef = el;
                    }}
                    data-testid="markdown-file-picker"
                    class="settings-file-input"
                    type="file"
                    accept=".md,text/markdown"
                    onChange={(event) => void handleMarkdownFilePick(event)}
                  />
                  <Show when={importExport.importStatus()}>
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
                  <h3 class="settings-section__title">Export Markdown</h3>
                  <p class="settings-section__desc">Export all pages as read-only Markdown with stable block IDs.</p>
                  <button
                    class="settings-action is-primary"
                    onClick={importExport.exportMarkdown}
                    disabled={importExport.exporting()}
                  >
                    {importExport.exporting() ? "Exporting..." : "Export all pages"}
                  </button>
                  <Show when={importExport.exportStatus()}>
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
                  <Show when={importExport.exportStatus()?.preview}>
                    {(preview) => (
                      <pre class="settings-preview"><code>{preview()}</code></pre>
                    )}
                  </Show>
                </div>
                <div class="settings-section">
                  <h3 class="settings-section__title">Offline backup</h3>
                  <p class="settings-section__desc">Export a zip archive with pages and assets for offline restore.</p>
                  <button
                    class="settings-action is-primary"
                    onClick={importExport.exportOfflineArchive}
                    disabled={importExport.offlineExporting()}
                  >
                    {importExport.offlineExporting() ? "Exporting..." : "Export offline archive"}
                  </button>
                  <Show when={importExport.offlineExportStatus()}>
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
                  <h3 class="settings-section__title">Offline restore</h3>
                  <p class="settings-section__desc">Import a zip archive to restore pages and assets.</p>
                  <div class="settings-actions">
                    <button
                      class="settings-action"
                      type="button"
                      onClick={openOfflineArchivePicker}
                    >
                      Choose archive
                    </button>
                    <button
                      class="settings-action is-primary"
                      onClick={importExport.importOfflineArchive}
                      disabled={importExport.offlineImporting()}
                    >
                      {importExport.offlineImporting() ? "Importing..." : "Import archive"}
                    </button>
                    <Show when={importExport.offlineImportFile()}>
                      {(file) => (
                        <span class="settings-value">{file().name}</span>
                      )}
                    </Show>
                  </div>
                  <input
                    ref={(el) => {
                      offlineArchivePickerRef = el;
                    }}
                    data-testid="offline-archive-picker"
                    class="settings-file-input"
                    type="file"
                    accept=".zip,application/zip"
                    onChange={(event) => handleOfflineArchivePick(event)}
                  />
                  <Show when={importExport.offlineImportStatus()}>
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
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
