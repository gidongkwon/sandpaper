import { For, Show, type Accessor, type Setter } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { VaultKeyStatus, VaultRecord } from "../../entities/vault/model/vault-types";
import type { VaultId } from "../../shared/model/id-types";

type SettingsVaultProps = {
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

type SettingsVaultTabProps = {
  isTauri: () => boolean;
  vault: SettingsVaultProps;
};

export const SettingsVaultTab = (props: SettingsVaultTabProps) => {
  let vaultFolderPickerRef: HTMLInputElement | undefined;

  const getFolderFromFile = (file: File) => {
    const withPath = file as File & { path?: string; webkitRelativePath?: string };
    if (withPath.path) return withPath.path;
    if (withPath.webkitRelativePath) {
      return withPath.webkitRelativePath.split("/")[0] || "";
    }
    return file.name.replace(/\.[^/.]+$/, "");
  };

  const openVaultFolderPicker = async () => {
    if (props.isTauri()) {
      const selection = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selection === "string") {
        props.vault.setNewPath(selection);
      }
      return;
    }
    vaultFolderPickerRef?.click();
  };

  const handleVaultFolderPick = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const nextPath = getFolderFromFile(file);
    if (nextPath) {
      props.vault.setNewPath(nextPath);
    }
    input.value = "";
  };

  return (
    <>
      <div class="settings-section">
        <h3 class="settings-section__title">Active Vault</h3>
        <select
          class="settings-select"
          value={props.vault.active()?.id ?? ""}
          onChange={(e) => props.vault.applyActiveVault(e.currentTarget.value)}
        >
          <For each={props.vault.list()}>
            {(entry) => <option value={entry.id}>{entry.name}</option>}
          </For>
        </select>
        <button
          class="settings-action"
          onClick={() => props.vault.setFormOpen((prev) => !prev)}
        >
          {props.vault.formOpen() ? "Cancel" : "New vault"}
        </button>
        <Show when={props.vault.formOpen()}>
          <div class="settings-form">
            <input
              class="settings-input"
              type="text"
              placeholder="Vault name"
              value={props.vault.newName()}
              onInput={(e) => props.vault.setNewName(e.currentTarget.value)}
            />
            <div class="settings-file-row">
              <input
                class="settings-input"
                type="text"
                placeholder="Vault path"
                value={props.vault.newPath()}
                onInput={(e) => props.vault.setNewPath(e.currentTarget.value)}
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
            <button
              class="settings-action is-primary"
              onClick={() => void props.vault.create()}
            >
              Create vault
            </button>
          </div>
        </Show>
        <div class="settings-row">
          <label class="settings-label">Shadow write queue</label>
          <span
            class={`settings-value ${
              props.vault.shadowPendingCount() > 0 ? "is-warning" : "is-success"
            }`}
          >
            {props.vault.shadowPendingCount()} pending
          </span>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-section__title">Encryption Key</h3>
        <p class="settings-section__desc">
          {props.vault.keyStatus().configured
            ? `Configured (${props.vault.keyStatus().kdf ?? "pbkdf2-sha256"})`
            : "Set a passphrase to enable E2E encryption."}
        </p>
        <input
          class="settings-input"
          type="password"
          placeholder="Passphrase"
          value={props.vault.passphrase()}
          onInput={(e) => props.vault.setPassphrase(e.currentTarget.value)}
        />
        <div class="settings-actions">
          <button
            class="settings-action is-primary"
            disabled={
              props.vault.keyBusy() || !props.vault.passphrase().trim()
            }
            onClick={() => void props.vault.setKey()}
          >
            {props.vault.keyBusy() ? "Deriving..." : "Set passphrase"}
          </button>
          <button
            class="settings-action"
            onClick={() => props.vault.setPassphrase("")}
          >
            Clear
          </button>
        </div>
        <Show when={props.vault.keyMessage()}>
          <div class="settings-message">{props.vault.keyMessage()}</div>
        </Show>
      </div>
    </>
  );
};
